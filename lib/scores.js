// Writer de la table `scores` — le chaînon manquant identifié par l'audit :
// computeScores (lib/scoring.js) existait mais n'était jamais persisté ni
// alimenté en firmographie réelle. Ici on assemble les trois ingrédients
// (signaux unifiés, firmographie SIRENE, coordonnées du contact) et on upsert.
// Zéro LLM, recalculable à tout moment.

import { computeScores } from "@/lib/scoring";
import { getCompanySignalsByAccount, mergeSignals } from "@/lib/signals";

/**
 * Recalcule et persiste les scores décomposés d'un prospect.
 * Non bloquant pour l'appelant : toute erreur est avalée (le scoring ne doit
 * jamais faire échouer une qualification).
 *
 * @param {object} supabase
 * @param {object} prospect — ligne prospects (id, account_id, email, phone, role…)
 * @param {{ researchSignals?: object[] }} opts — signaux JSONB de la dernière recherche
 * @returns {Promise<object|null>} les scores calculés, ou null en cas d'erreur
 */
export async function recomputeProspectScores(supabase, prospect, { researchSignals = [] } = {}) {
  try {
    // Firmographie : prospect.account → account.company_id → companies (SIRENE).
    let firmographics = {};
    let companySignals = [];

    if (prospect.account_id) {
      const { data: account } = await supabase
        .from("accounts")
        .select("id, company_id")
        .eq("id", prospect.account_id)
        .maybeSingle();

      if (account?.company_id) {
        const { data: company } = await supabase
          .from("companies")
          .select("siren, naf_code, effectif_min, effectif_max, effectif_tranche, categorie")
          .eq("id", account.company_id)
          .maybeSingle();
        if (company) firmographics = company;
      }

      const byAccount = await getCompanySignalsByAccount(
        supabase,
        [prospect.account_id],
        account?.company_id ? [account.company_id] : []
      );
      companySignals = [
        ...(byAccount.get(prospect.account_id) || []),
        ...(account?.company_id ? byAccount.get(`company:${account.company_id}`) || [] : []),
      ];
    }

    const signals = mergeSignals(companySignals, researchSignals);
    const scores = computeScores({ prospect, signals, firmographics });

    await supabase.from("scores").upsert(
      {
        prospect_id: prospect.id,
        global_score: scores.global_score,
        urgency_score: scores.urgency_score,
        business_score: scores.business_score,
        accessibility_score: scores.accessibility_score,
        it_maturity_score: scores.it_maturity_score,
        breakdown: scores.breakdown,
        weights_version: scores.weights_version,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "prospect_id" }
    );

    return scores;
  } catch (e) {
    console.error("[scores] recompute error:", e.message);
    return null;
  }
}
