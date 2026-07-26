// Métadonnées des étapes du pipeline (FV2) — pures, partagées client + serveur.

export const OPP_STAGES = ["qualification", "decouverte", "proposition", "negociation", "gagne", "perdu"];
export const OPP_OPEN_STAGES = ["qualification", "decouverte", "proposition", "negociation"];

export const OPP_STAGE_LABEL = {
  qualification: "Qualification",
  decouverte: "Découverte",
  proposition: "Proposition",
  negociation: "Négociation",
  gagne: "Gagné",
  perdu: "Perdu",
};

// Probabilité par défaut d'une étape (utilisée si l'utilisateur n'a rien saisi).
export const OPP_STAGE_PROBABILITY = {
  qualification: 10, decouverte: 25, proposition: 50, negociation: 70, gagne: 100, perdu: 0,
};

export const OPP_STAGE_COLOR = {
  qualification: "#64748B", decouverte: "#0078D4", proposition: "#5B53E6",
  negociation: "#E8730C", gagne: "#107C10", perdu: "#C50F1F",
};

// Probabilité effective : celle saisie, sinon la valeur par défaut de l'étape.
export function effectiveProbability(opp) {
  if (opp.probability != null) return opp.probability;
  return OPP_STAGE_PROBABILITY[opp.stage] ?? 0;
}

// Montant pondéré (prévision) d'une affaire. Gagné = plein montant, perdu = 0.
export function weightedAmount(opp) {
  if (opp.stage === "gagne") return Number(opp.amount_eur) || 0;
  if (opp.stage === "perdu") return 0;
  return ((Number(opp.amount_eur) || 0) * effectiveProbability(opp)) / 100;
}
