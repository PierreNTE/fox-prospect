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

  // Cartographie : on remplace les seules fiches NON validées par la nouvelle proposition.
  const { data: keep } = await supabase
    .from("account_contacts")
    .select("id, first_name, last_name, validated")
    .eq("account_id", account.id);
  const validated = (keep || []).filter((c) => c.validated);
  const validatedNames = new Set(
    validated.map((c) => `${c.first_name}|${c.last_name}`.toLowerCase().trim())
  );

  // Purge des propositions précédentes non validées.
  await supabase
    .from("account_contacts")
    .delete()
    .eq("account_id", account.id)
    .eq("validated", false);

  const org = (result.org || []).filter(
    (p) => (p.first_name || p.last_name) &&
      !validatedNames.has(`${p.first_name || ""}|${p.last_name || ""}`.toLowerCase().trim())
  );

  // Insertion en lot (évite le N+1 précédent d'un insert par contact).
  let inserted = [];
  if (org.length > 0) {
    const rows = org.map((p) => ({
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
    // Ré-attacher manager_name (non stocké en base) pour la résolution hiérarchique.
    inserted = (data || []).map((row, i) => ({ ...row, manager_name: org[i]?.manager_name || "" }));
  }

  // Résolution des liens hiérarchiques par nom (sur l'ensemble : proposés + validés).
  const all = [...validated, ...inserted];
  const byName = new Map(
    all.map((c) => [`${c.first_name}|${c.last_name}`.toLowerCase().trim(), c.id])
  );
  for (const c of inserted) {
    const mgr = (c.manager_name || "").toLowerCase().trim();
    if (!mgr) continue;
    const managerId =
      byName.get(mgr) ||
      [...byName.entries()].find(([k]) => mgr.endsWith(k.split("|")[1]) && k.split("|")[1])?.[1];
    if (managerId && managerId !== c.id) {
      await supabase.from("account_contacts").update({ manager_id: managerId }).eq("id", c.id);
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
