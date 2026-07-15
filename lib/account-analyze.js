import { callClaudeJson } from "@/lib/anthropic";
import { validateAccount } from "@/lib/schemas";
import { logAiRun } from "@/lib/ai-runs";
import { resolveSiren, upsertCompany } from "@/lib/sirene";
import { accountSystemPrompt, accountUserPrompt } from "@/lib/prompts-accounts";

// Analyse un compte par recherche web et met à jour sa fiche + sa cartographie.
// Réutilisé par /api/accounts/analyze (à la demande) et /api/cron/refresh-accounts (veille).
// Renvoie { news, signals, org } (compteurs côté appelant).
//
// Principe « l'IA propose, tu valides » : les contacts proposés sont insérés
// avec validated=false. On ne supprime jamais un contact déjà validé par Pierre :
// la ré-analyse ne touche qu'aux fiches non validées (anti-écrasement du travail manuel).
export async function analyzeAccount(supabase, account) {
  const { json: raw, usage, webSearchCount } = await callClaudeJson({
    system: accountSystemPrompt(),
    user: accountUserPrompt({ account }),
    maxTokens: 4000,
    webSearch: true,
    maxSearches: Number(process.env.RESEARCH_MAX_SEARCHES) || 2,
  });

  // Validation + coercition des types avant toute écriture en base.
  const result = validateAccount(raw);

  await supabase
    .from("accounts")
    .update({
      sector: result.sector || account.sector || "",
      hq: result.hq || account.hq || "",
      website: account.website || result.website || "",
      domain: result.domain || account.domain || "",
      summary: result.summary || "",
      news: result.news || [],
      signals: result.signals || [],
      sources: result.sources || [],
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  // Cartographie : MERGE (accumulation) plutôt que purge. L'organigramme se
  // complète au fil des analyses et ne perd JAMAIS une coordonnée déjà enrichie
  // ni une fiche validée manuellement. Règle simple : on ne remplit que les
  // champs VIDES (fill-blanks), jamais d'écrasement.
  const norm = (fn, ln) => `${fn || ""}|${ln || ""}`.toLowerCase().trim();
  const { data: existingRows } = await supabase
    .from("account_contacts")
    .select("*")
    .eq("account_id", account.id);
  const byName = new Map((existingRows || []).map((c) => [norm(c.first_name, c.last_name), c]));

  const proposed = (result.org || []).filter((p) => p.first_name || p.last_name);

  // 1) Personnes déjà connues : compléter les trous uniquement.
  for (const p of proposed) {
    const cur = byName.get(norm(p.first_name, p.last_name));
    if (!cur) continue;
    const patch = {};
    for (const field of ["role", "department", "level", "responsibilities", "email", "phone", "linkedin_url"]) {
      if (p[field] && !(cur[field] || "").toString().trim()) patch[field] = p[field];
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from("account_contacts").update(patch).eq("id", cur.id);
      Object.assign(cur, patch);
    }
  }

  // 2) Nouvelles personnes : insertion en lot.
  const fresh = proposed.filter((p) => !byName.has(norm(p.first_name, p.last_name)));
  let inserted = [];
  if (fresh.length > 0) {
    const rows = fresh.map((p) => ({
      account_id: account.id,
      first_name: p.first_name,
      last_name: p.last_name,
      role: p.role,
      department: p.department,
      level: p.level,
      responsibilities: p.responsibilities,
      email: p.email,
      phone: p.phone,
      linkedin_url: p.linkedin_url,
      reliability: p.reliability,
      role_confidence: p.role_confidence,
      data_date: p.data_date,
      source: p.source,
      validated: false,
    }));
    const { data } = await supabase.from("account_contacts").insert(rows).select();
    inserted = data || [];
    inserted.forEach((row) => byName.set(norm(row.first_name, row.last_name), row));
  }

  // 3) Liens hiérarchiques par nom, SANS écraser un rattachement déjà posé.
  const managerByPerson = new Map(
    proposed.map((p) => [norm(p.first_name, p.last_name), (p.manager_name || "").toLowerCase().trim()])
  );
  for (const [key, c] of byName) {
    if (c.manager_id) continue;
    const mgrName = managerByPerson.get(key);
    if (!mgrName) continue;
    const mgr =
      byName.get(mgrName) ||
      [...byName.values()].find((x) => {
        const ln = norm(x.first_name, x.last_name).split("|")[1];
        return ln && mgrName.endsWith(ln);
      });
    if (mgr && mgr.id !== c.id) {
      await supabase.from("account_contacts").update({ manager_id: mgr.id }).eq("id", c.id);
      c.manager_id = mgr.id;
    }
  }

  // 4) Enrichissement automatique : enfile un job enrich_contact pour chaque
  // personne SANS coordonnée exploitable et JAMAIS tentée (email_confidence
  // vide = marqueur « pas encore enrichi »). Le drain (process-jobs) l'exécute
  // dans le budget. Dédup contre les jobs déjà en file → un contact = une tentative.
  const needEnrich = [...byName.values()].filter(
    (c) => !(c.email || "").trim() && !(c.phone || "").trim() && !(c.linkedin_url || "").trim()
      && !(c.email_confidence || "").trim()
  );
  if (needEnrich.length > 0) {
    const { data: pendingEnrich } = await supabase
      .from("jobs")
      .select("payload")
      .eq("kind", "enrich_contact")
      .in("status", ["pending", "running"]);
    const queued = new Set((pendingEnrich || []).map((j) => j.payload?.contact_id).filter(Boolean));
    const toEnqueue = needEnrich.filter((c) => !queued.has(c.id));
    if (toEnqueue.length > 0) {
      await supabase.from("jobs").insert(
        toEnqueue.map((c) => ({ kind: "enrich_contact", payload: { contact_id: c.id }, status: "pending" }))
      );
    }
  }

  // Résolution SIREN en arrière-plan — enrichit companies et rattache le compte.
  // Silencieux si la table companies n'existe pas encore (avant migration-v1.sql).
  resolveSiren({ name: account.name, domain: result.domain || account.domain })
    .then(async (sireneData) => {
      if (!sireneData) return;
      const companyId = await upsertCompany(supabase, sireneData, {
        domain: result.domain || account.domain || undefined,
      });
      if (companyId) {
        await supabase.from("accounts").update({ company_id: companyId }).eq("id", account.id);
      }
    })
    .catch(() => {}); // non bloquant

  // Comptabilité des tokens en arrière-plan (non bloquant).
  logAiRun({ route: "analyze", accountId: account.id, usage, webSearchCount });

  return {
    news: (result.news || []).length,
    signals: (result.signals || []).length,
    org: inserted.length,
  };
}
