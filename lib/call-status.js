// Suivi d'appel d'un lead : remplace agenda, séquences et pipeline.
export const CALL_STATUS = [
  { value: "a_appeler", label: "À appeler", color: "informative" },
  { value: "pas_joignable", label: "Pas joignable", color: "warning" },
  { value: "rappeler", label: "À rappeler", color: "important" },
  { value: "rdv", label: "RDV pris", color: "success" },
  { value: "pas_interesse", label: "Pas intéressé", color: "subtle" },
  { value: "mauvais_contact", label: "Mauvais contact", color: "danger" },
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
