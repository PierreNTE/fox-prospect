import { getSupabase } from "@/lib/supabase";

// Kill-switch budgétaire — garantit un plafond de dépense Anthropic en €.
// Le compteur DAILY_RESEARCH_CAP borne le NOMBRE d'appels/jour, mais pas la
// facture (un jour de gros "Tout qualifier" peut coûter cher). Ici on somme le
// coût réel loggé dans ai_runs depuis le 1er du mois (UTC). Vaut pour le
// manuel ET l'autonome.
//
// DEUX barrières, et la seconde est née d'un constat de facture : en juillet
// 2026, la totalité du budget mensuel a été consommée entre le 1er et le 4,
// laissant vingt-trois jours sans outil. Un plafond mensuel seul ne protège que
// du dépassement, pas de l'épuisement précoce — il autorise à tout dépenser le
// premier jour, ce qui est exactement ce qui s'est produit.
//
//   1. plafond MENSUEL   : on ne dépasse jamais MONTHLY_BUDGET_EUR ;
//   2. rythme QUOTIDIEN  : au jour D d'un mois de N jours, on ne dépasse pas
//                          budget × D/N, plus une réserve de démarrage.
//
// Le rythme n'est pas une enveloppe qui se périme : ce qui n'est pas dépensé un
// jour reste acquis les jours suivants, puisque l'autorisation est calculée sur
// le cumul du mois et non sur la journée. Une semaine sans usage se retrouve
// intégralement disponible ensuite.

// 13 € et non 15, et ce n'est pas une préférence : c'est un accord de plafonds.
//
// `ai_runs` sous-estime la facture. Rapproché sur le relevé de console du
// 2026-07-27, jour où aucun script non journalisé n'a tourné : 3,06 $ calculés
// contre 3,72 $ facturés, soit **~1,31 $ de facture par euro d'ai_runs**
// (conversion EUR→USD comprise, plus le micro-appel non journalisé d'/api/health).
//
// À 15 €, le kill-switch se déclenche vers 19,70 $ — au ras d'un plafond de
// compte à 20 $. Le compte serait donc coupé par Anthropic AVANT que cette
// garde ne serve à quoi que ce soit, ce qui est précisément ce qui s'est passé
// en juillet. À 13 €, la coupure applicative tombe vers 17 $ et garde la main.
//
// Si le plafond de la console bouge, celui-ci doit bouger avec : les deux ne se
// protègent l'un l'autre que s'ils sont accordés.
export function monthlyBudgetEur() {
  return Number(process.env.MONTHLY_BUDGET_EUR) || 13;
}

// Part du budget utilisable d'un bloc, en plus de l'acquis du jour.
//
// Sans elle, le 1er du mois n'autoriserait que 1/31e du budget — environ 0,48 €,
// soit une douzaine de qualifications. L'outil serait inutilisable le jour même
// où l'on veut s'en servir, et le réflexe serait de relever MONTHLY_BUDGET_EUR,
// c'est-à-dire de désarmer la protection. Une réserve rend le lissage tenable.
const RESERVE_RATIO = 0.15;

// Le lissage se désarme sans redéploiement (BUDGET_PACING=off) : si le rythme
// gêne un usage légitime, mieux vaut une bascule explicite qu'un plafond
// mensuel relevé, qui lui supprime la protection de fond.
function pacingActif() {
  return String(process.env.BUDGET_PACING || "").toLowerCase() !== "off";
}

/**
 * Autorisation de dépense cumulée à ce jour du mois.
 * @param {Date} now
 * @param {number} budget
 * @returns {{ dayOfMonth: number, daysInMonth: number, allowance: number, budget: number }}
 */
export function pacingState(now = new Date(), budget = monthlyBudgetEur()) {
  const annee = now.getUTCFullYear();
  const mois = now.getUTCMonth();
  // Jour 0 du mois suivant = dernier jour du mois courant. Gère février et les
  // années bissextiles sans table.
  const daysInMonth = new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const acquis = (budget * dayOfMonth) / daysInMonth;
  const allowance = pacingActif()
    ? Math.min(budget, acquis + budget * RESERVE_RATIO)
    : budget;
  return { dayOfMonth, daysInMonth, allowance, budget };
}

// Coût Anthropic cumulé depuis le 1er du mois courant (UTC), en euros.
// SUM côté SQL (RPC monthly_ai_spend, migration-v7) : O(1) au lieu de charger
// toutes les lignes du mois. Fallback sur l'ancien chemin si la RPC n'existe
// pas encore (migration non appliquée).
export async function monthlySpendEur(supabase = getSupabase()) {
  const { data: rpcSum, error } = await supabase.rpc("monthly_ai_spend");
  if (!error && rpcSum !== null && rpcSum !== undefined) return Number(rpcSum) || 0;

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data } = await supabase
    .from("ai_runs")
    .select("cost_eur")
    .gte("created_at", start);
  return (data || []).reduce((sum, r) => sum + (r.cost_eur || 0), 0);
}

/**
 * État budgétaire complet — à appeler avant tout appel LLM coûteux.
 *
 * `reason` distingue les deux coupures, et c'est la seule chose qui importe
 * pour l'utilisateur : « mois » impose d'attendre le 1er ou de relever le
 * plafond, « rythme » se rouvre tout seul demain matin.
 */
export async function checkMonthlyBudget(supabase = getSupabase(), now = new Date()) {
  const budget = monthlyBudgetEur();
  const spent = await monthlySpendEur(supabase);
  const { allowance, dayOfMonth, daysInMonth } = pacingState(now, budget);

  const moisAtteint = spent >= budget;
  const rythmeAtteint = spent >= allowance;

  return {
    exceeded: moisAtteint || rythmeAtteint,
    reason: moisAtteint ? "mois" : rythmeAtteint ? "rythme" : null,
    spent,
    budget,
    allowance,
    dayOfMonth,
    daysInMonth,
  };
}

/**
 * Message d'erreur adressé à l'utilisateur, cohérent avec la cause réelle.
 *
 * Annoncer « reprise le 1er du mois » alors que la coupure se rouvre demain
 * pousse à relever MONTHLY_BUDGET_EUR pour rien — et donc à supprimer la
 * protection au lieu d'attendre douze heures.
 */
export function budgetMessage(state) {
  const { reason, spent, budget, allowance } = state;
  if (reason === "rythme") {
    return `Rythme de dépense atteint pour aujourd'hui (${spent.toFixed(2)} € sur ${allowance.toFixed(2)} € ouverts à ce stade du mois, budget total ${budget} €). Reprise demain : l'enveloppe se libère jour après jour pour couvrir le mois entier.`;
  }
  return `Budget mensuel atteint (${spent.toFixed(2)} € / ${budget} €). Reprise le 1er du mois prochain, ou augmente MONTHLY_BUDGET_EUR.`;
}
