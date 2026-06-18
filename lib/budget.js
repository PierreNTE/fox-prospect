import { getSupabase } from "@/lib/supabase";

// Kill-switch budgétaire mensuel — garantit un plafond de dépense Anthropic en €.
// Le compteur DAILY_RESEARCH_CAP borne le NOMBRE d'appels/jour, mais pas la
// facture (un jour de gros "Tout qualifier" peut coûter cher). Ici on somme le
// coût réel loggé dans ai_runs depuis le 1er du mois (UTC) et on coupe net dès
// que MONTHLY_BUDGET_EUR est atteint. Vaut pour le manuel ET l'autonome.
//
// Réinitialisation automatique : le 1er du mois suivant, la somme repart à 0.

export function monthlyBudgetEur() {
  return Number(process.env.MONTHLY_BUDGET_EUR) || 15;
}

// Coût Anthropic cumulé depuis le 1er du mois courant (UTC), en euros.
export async function monthlySpendEur(supabase = getSupabase()) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data } = await supabase
    .from("ai_runs")
    .select("cost_eur")
    .gte("created_at", start);
  return (data || []).reduce((sum, r) => sum + (r.cost_eur || 0), 0);
}

// { exceeded, spent, budget } — à appeler avant tout appel LLM coûteux.
export async function checkMonthlyBudget(supabase = getSupabase()) {
  const budget = monthlyBudgetEur();
  const spent = await monthlySpendEur(supabase);
  return { exceeded: spent >= budget, spent, budget };
}
