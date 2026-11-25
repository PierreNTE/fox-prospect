// Session d'appels : file des leads à appeler aujourd'hui et résultat d'un appel.
// Fonctions pures (testées dans tests/call-session.test.js).
import { isFinalStatus, recallDue, sortLeadsByStatus } from "./call-status.js";
import { NO_ANSWER_LIMIT } from "./call-history.js";

/** Numéro au format international (+33…), pour les liens tel: et les QR codes. */
export function toE164(number) {
  let d = String(number || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = `+${d.slice(2)}`;
  if (d.startsWith("+")) return d;
  if (/^0\d{9}$/.test(d)) return `+33${d.slice(1)}`;
  return d;
}

export const telHref = (number) => `tel:${toE164(number)}`;

/** Lead encore ouvert : société active et lead non clos dans Salesforce. */
export const isLeadOpen = (l) =>
  ["active", "vigilance"].includes(l.health_status) && !/closed|rejected/i.test(l.sf_lead_status || "");

/** Ajoute n jours ouvrés (samedi et dimanche sautés) à une date AAAA-MM-JJ. */
export function addBusinessDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Déjà traité aujourd'hui (un résultat d'appel a été noté ce jour). */
const treatedToday = (l, day) =>
  !!l.call_status && l.call_status !== "a_appeler" && String(l.call_updated_at || "").slice(0, 10) === day;

/**
 * File du jour : leads ouverts, sans résultat final, sans rappel prévu plus tard,
 * pas déjà traités aujourd'hui. Ordre : New → Working → autres, rappels dus d'abord.
 */
export function buildCallQueue(leads, day) {
  const todo = (leads || []).filter((l) => isLeadOpen(l)
    && !isFinalStatus(l.call_status)
    && (!l.recall_at || recallDue(l.recall_at, day))
    && !treatedToday(l, day));
  // Après plusieurs essais sans réponse d'affilée, le lead passe en fin de file.
  const sorted = sortLeadsByStatus(todo, day);
  const tired = (l) => (l.no_answer_streak || 0) >= NO_ANSWER_LIMIT;
  return [...sorted.filter((l) => !tired(l)), ...sorted.filter(tired)];
}

/** Numéro à composer en premier : la personne si on a sa ligne, sinon le standard. */
export function primaryNumber(l) {
  if (l?.contact?.phone) return { number: l.contact.phone, kind: "contact" };
  if (l?.standard?.number) return { number: l.standard.number, kind: "standard" };
  return null;
}

export const OUTCOMES = [
  { value: "pas_joignable", label: "Pas joignable / répondeur", short: "Répondeur", appearance: "secondary" },
  { value: "rappeler", label: "À rappeler", short: "À rappeler", appearance: "secondary" },
  { value: "rdv", label: "RDV pris", short: "RDV", appearance: "primary" },
  { value: "pas_interesse", label: "Pas intéressé", short: "Pas intéressé", appearance: "secondary" },
  { value: "mauvais_contact", label: "Mauvais contact", short: "Mauvais contact", appearance: "secondary" },
  { value: "faux_numero", label: "Numéro non attribué", short: "Faux numéro", appearance: "secondary" },
];

/**
 * Corps du PATCH /api/accounts/[id] pour un résultat d'appel.
 * Répondeur : rappel dans 2 jours ouvrés. À rappeler : date choisie (défaut lendemain ouvré).
 */
export function outcomePatch(outcome, { day, recallAt, note } = {}) {
  const body = { call_status: outcome, log_call: true };
  if (outcome === "pas_joignable") body.recall_at = addBusinessDays(day, 2);
  else if (outcome === "rappeler") body.recall_at = recallAt || addBusinessDays(day, 1);
  else body.recall_at = null;
  if (typeof note === "string") body.call_note = note.slice(0, 2000);
  return body;
}
