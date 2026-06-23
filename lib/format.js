// Formatage monétaire € à la française : 2 décimales, séparateur de milliers.
// Évite l'ambiguïté de toFixed (« 12.821 » lu comme 12 821 €). Donne « 12,82 € »,
// « 1 204,50 € ». Utilisé partout où un montant en euros est affiché.
const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function eur(n) {
  return EUR.format(Number.isFinite(n) ? n : 0);
}
