// Tokens de design centralisés — source unique des couleurs sémantiques.
// Avant ce module, chaque écran redéclarait ses hex (#5B53E6, #107C10…) :
// le dark mode et toute évolution de palette exigeaient N fichiers.
// Les couleurs neutres restent des variables CSS Fluent (déjà thémées).

export const COLORS = Object.freeze({
  brand: "#5B53E6",       // indigo Fox — actions primaires
  success: "#107C10",     // vert Fluent — positif, téléphone, client
  warning: "#F6A623",     // ambre — relances, en cours
  danger: "#C50F1F",      // rouge Fluent — retard, refus, alertes
  info: "#0078D4",        // bleu Fluent — contacté
  accent: "#E8730C",      // orange — intéressé, échéance jour J
  purple: "#8e44ad",      // enrichissement
  neutral: "var(--colorNeutralForeground3)",
});

// Couleur d'une étape du funnel commercial (du plus froid au plus chaud).
export const STAGE_COLORS = Object.freeze({
  non_contacte: COLORS.neutral,
  contacte: COLORS.info,
  en_cours: COLORS.warning,
  interesse: COLORS.accent,
  refuse: COLORS.danger,
  client: COLORS.success,
});

// Couleur d'une action NBA (Next Best Action).
export const NBA_COLORS = Object.freeze({
  prepare_rdv: COLORS.success, avancer: COLORS.success, fideliser: COLORS.success, appeler: COLORS.success,
  relance_urgente: COLORS.danger, relance: COLORS.warning, relance_prevue: COLORS.danger,
  generer: COLORS.brand, enrichir: COLORS.purple,
  envoyer: COLORS.brand, rechercher: COLORS.brand,
  opt_out: COLORS.neutral, archive: COLORS.neutral,
});

// Feu tricolore d'un score 0-100.
export function scoreColor(score) {
  if (score == null) return COLORS.neutral;
  return score >= 70 ? COLORS.success : score >= 40 ? COLORS.warning : COLORS.danger;
}
