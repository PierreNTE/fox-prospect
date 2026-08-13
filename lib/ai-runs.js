// QW7 — persistance de chaque appel LLM : route, tokens, coût estimé.
// La table ai_runs doit exister (voir supabase/migration-quickwins.sql).

import { getSupabase } from "@/lib/supabase";
import { ANTHROPIC_TARIF, MODEL_SONNET } from "@/lib/constants";

/**
 * Calcule le coût en euros d'un appel Anthropic.
 * @param {{ input_tokens?: number, output_tokens?: number }} usage
 * @param {number} webSearchCount
 * @param {string} model
 */
function estimateCostEur(usage, webSearchCount = 0, model = MODEL_SONNET) {
  const inp = usage?.input_tokens ?? 0;
  const out = usage?.output_tokens ?? 0;
  const isHaiku = model.includes("haiku");
  const inputRate = isHaiku ? ANTHROPIC_TARIF.haiku_input_per_m_eur : ANTHROPIC_TARIF.sonnet_input_per_m_eur;
  const outputRate = isHaiku ? ANTHROPIC_TARIF.haiku_output_per_m_eur : ANTHROPIC_TARIF.sonnet_output_per_m_eur;
  return (inp / 1_000_000) * inputRate
    + (out / 1_000_000) * outputRate
    + (webSearchCount / 1_000) * ANTHROPIC_TARIF.web_search_per_k_eur;
}

/**
 * Insère une ligne dans ai_runs. Non-bloquant : les erreurs sont avalées pour
 * ne jamais faire échouer la route principale à cause du logging.
 *
 * @param {{ route: string, prospectId?: number, accountId?: number,
 *           usage?: object, webSearchCount?: number, model?: string }} opts
 */
export async function logAiRun({ route, prospectId, accountId, usage, webSearchCount = 0, model = MODEL_SONNET }) {
  if (!usage) return;
  const costEur = estimateCostEur(usage, webSearchCount, model);
  const supabase = getSupabase();
  supabase.from("ai_runs").insert({
    route,
    prospect_id: prospectId ?? null,
    account_id: accountId ?? null,
    // Le modèle est la donnée qui manquait le plus. Sans elle, `cost_eur` est un
    // nombre qu'on ne peut plus vérifier : le tarif Haiku est resté faux d'un
    // facteur 3,7 pendant des semaines sans que rien ne puisse le révéler, et il
    // a fallu le reconstruire par inférence sur le tarif implicite pour le
    // corriger. Une colonne rend l'erreur suivante détectable en une requête.
    model,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    web_search_count: webSearchCount,
    cost_eur: Math.round(costEur * 100_000) / 100_000,
  }).then(({ error }) => {
    if (error) console.error("[ai-runs] insert error:", error.message);
  });
}
