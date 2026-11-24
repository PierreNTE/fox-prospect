// Suivi d'appel d'un lead : remplace agenda, séquences et pipeline.
export const CALL_STATUS = [
  { value: "a_appeler", label: "À appeler", color: "informative" },
  { value: "pas_joignable", label: "Pas joignable", color: "warning" },
  { value: "rappeler", label: "À rappeler", color: "important" },
  { value: "rdv", label: "RDV pris", color: "success" },
  { value: "pas_interesse", label: "Pas intéressé", color: "subtle" },
  { value: "mauvais_contact", label: "Mauvais contact", color: "danger" },
  { value: "faux_numero", label: "Numéro non attribué", color: "danger" },
];
export const CALL_STATUS_META = Object.fromEntries(CALL_STATUS.map((s) => [s.value, s]));

/** Statut final : le lead sort de la liste « À appeler ». */
export const isFinalStatus = (s) => s === "rdv" || s === "pas_interesse";

/** Rappel échu (aujourd'hui ou avant). */
export function recallDue(recallAt, today = new Date().toISOString().slice(0, 10)) {
  return !!recallAt && String(recallAt).slice(0, 10) <= today;
}

// Statut du lead dans Salesforce, en français (affichage).
const SF_FR = { new: "Nouveau", working: "En cours", "closed by sales": "Clos", nurture: "En maturation", converted: "Converti", qualified: "Qualifié", unqualified: "Non qualifié" };
export function sfStatusLabel(status) {
  const v = String(status || "").trim();
  return SF_FR[v.toLowerCase()] || v;
}

// Ordre d'affichage des leads selon leur statut Salesforce :
// New (0), Working (1), autres statuts (2), Closed… (3).
export function sfStatusRank(status) {
  const st = String(status || "").trim().toLowerCase();
  if (st === "new" || st === "n") return 0;
  if (st === "working") return 1;
  if (/closed|clos/.test(st)) return 3;
  return 2;
}

// Trie les leads : statut (New → Working → autres → Closed), puis rappels
// du jour en tête, puis l'ordre reçu (priorité calculée côté serveur).
export function sortLeadsByStatus(leads, day) {
  return (leads || [])
    .map((l, i) => ({ l, i }))
    .sort((x, y) => (sfStatusRank(x.l.sf_lead_status) - sfStatusRank(y.l.sf_lead_status))
      || (Number(recallDue(y.l.recall_at, day)) - Number(recallDue(x.l.recall_at, day)))
      || (x.i - y.i))
    .map(({ l }) => l);
}
