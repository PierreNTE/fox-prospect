// Thème de marque Fox Prospect pour Fluent UI React v9.
// Rampe indigo (16 nuances Fluent : 10 = foncé → 160 = clair) générée pour la
// nouvelle identité « trust / tech ». L'ambre-renard est un token d'accent à part
// (Fluent n'a qu'une rampe de marque) — utilisé pour les éléments d'énergie/identité.

import { createLightTheme, createDarkTheme } from "@fluentui/react-components";

export const foxBrand = {
  10: "#05021A",
  20: "#120A3A",
  30: "#190C53",
  40: "#21106C",
  50: "#281585",
  60: "#301B9E",
  70: "#3922B7",
  80: "#4733CB",
  90: "#5B53E6",
  100: "#6E66EB",
  110: "#8079EF",
  120: "#948EF2",
  130: "#ABA6F5",
  140: "#C3BFF8",
  150: "#DCD9FB",
  160: "#F1F0FE",
};

// Accent ambre-renard (hors rampe de marque). À utiliser pour les CTA secondaires,
// badges d'identité, points d'attention — pas pour le texte courant.
export const FOX_AMBER = "#F6A623";
export const FOX_AMBER_INK = "#633806"; // texte sur fond ambre clair

export const foxLightTheme = createLightTheme(foxBrand);
export const foxDarkTheme = createDarkTheme(foxBrand);

// Ajustement : coins légèrement plus arrondis pour un rendu « premium SaaS ».
foxLightTheme.borderRadiusMedium = "6px";
foxLightTheme.borderRadiusLarge = "10px";
foxDarkTheme.borderRadiusMedium = "6px";
foxDarkTheme.borderRadiusLarge = "10px";
