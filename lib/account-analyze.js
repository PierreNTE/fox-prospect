import { callClaudeJson } from "@/lib/anthropic";
import { accountSystemPrompt, accountUserPrompt } from "@/lib/prompts-accounts";

// Analyse un compte par recherche web et met à jour sa fiche + sa cartographie.
// Réutilisé par /api/accounts/analyze (à la demande) et /api/cron/refresh-accounts (veille).
// Renvoie { news, signals, org } (compteurs côté appelant).
//
// Principe « l'IA propose, tu valides » : les contacts proposés sont insérés
// avec validated=false. On ne supprime jamais un contact déjà validé par Pierre :
// la ré-analyse ne touche qu'aux fiches non validées (anti-écrasement du travail manuel).
export async function analyzeAccount(supabase, account) {
  const { json: result } = await callClaudeJson({
    system: accountSystemPrompt(),
    user: accountUserPrompt({ account }),
    maxTokens: 4000,
    webSearch: true,
    maxSearches: Number(process.env.RESEARCH_MAX_SEARCHES) || 4,
  });

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

  // Insertion sans manager d'abord (on a besoin des id pour relier l'arbre ensuite).
  const inserted = [];
  for (const p of org) {
    const { data } = await supabase
      .from("account_contacts")
      .insert({
        account_id: account.id,
        first_name: (p.first_name || "").trim(),
        last_name: (p.last_name || "").trim(),
        role: (p.role || "").trim(),
        responsibilities: (p.responsibilities || "").trim(),
        reliability: ["verifie", "partiel", "non_verifie"].includes(p.reliability) ? p.reliability : "non_verifie",
        role_confidence: ["certain", "probable", "incertain"].includes(p.role_confidence) ? p.role_confidence : "incertain",
        data_date: (p.data_date || "").trim(),
        source: (p.source || "").trim(),
        validated: false,
      })
      .select()
      .single();
    if (data) inserted.push({ ...data, manager_name: p.manager_name || "" });
  }

  // Résolution des liens hiérarchiques par nom (sur l'ensemble : proposés + validés).
  const all = [...validated, ...inserted];
  const byName = new Map(
    all.map((c) => [`${c.first_name}|${c.last_name}`.toLowerCase().trim(), c.id])
  );
  for (const c of inserted) {
    const mgr = (c.manager_name || "").toLowerCase().trim();
    if (!mgr) continue;
    const managerId = byName.get(mgr) || [...byName.entries()].find(([k]) => mgr.endsWith(k.split("|")[1]) && k.split("|")[1])?.[1];
    if (managerId && managerId !== c.id) {
      await supabase.from("account_contacts").update({ manager_id: managerId }).eq("id", c.id);
    }
  }

  return {
    news: (result.news || []).length,
    signals: (result.signals || []).length,
    org: inserted.length,
  };
}
