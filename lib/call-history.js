// Historique des appels (table call_log) : tentatives par lead et bilan de la semaine.
// Fonctions pures (testées dans tests/call-history.test.js).

/** Résultats où quelqu'un a décroché (on a parlé à une personne). */
export const REACHED = new Set(["rdv", "pas_interesse", "rappeler", "mauvais_contact"]);

/** Nombre d'essais sans réponse d'affilée à partir duquel le lead passe en fin de file. */
export const NO_ANSWER_LIMIT = 3;

/** Date locale AAAA-MM-JJ d'un horodatage. */
export function localDay(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Résumé des appels d'un lead : nombre de tentatives, essais sans réponse
 * d'affilée (les plus récents), date du dernier appel.
 * calls : [{ outcome, at }] dans n'importe quel ordre.
 */
export function attemptsInfo(calls) {
  const list = [...(calls || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let streak = 0;
  for (let i = list.length - 1; i >= 0 && list[i].outcome === "pas_joignable"; i--) streak++;
  return { attempts: list.length, no_answer_streak: streak, last_call_at: list.length ? list[list.length - 1].at : null };
}

/** Lundi de la semaine d'une date AAAA-MM-JJ. */
export function mondayOf(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/**
 * Bilan de la semaine en cours (lundi → dimanche) à partir des appels des leads.
 * dayOf : convertit un horodatage en jour (heure locale par défaut).
 */
export function weekStats(leads, day, { dayOf = localDay } = {}) {
  const start = mondayOf(day);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const inWeek = new Set(days);
  const perDay = Object.fromEntries(days.map((d) => [d, 0]));
  const out = { start, end: days[6], calls: 0, reached: 0, no_answer: 0, rdv: 0, not_interested: 0, wrong: 0,
    leads_called: 0, by_verdict: {}, by_day: [] };
  for (const l of leads || []) {
    let touched = false;
    for (const c of l.calls || []) {
      const d = dayOf(c.at);
      if (!inWeek.has(d)) continue;
      touched = true;
      out.calls++;
      perDay[d]++;
      if (REACHED.has(c.outcome)) out.reached++;
      if (c.outcome === "pas_joignable") out.no_answer++;
      if (c.outcome === "rdv") out.rdv++;
      if (c.outcome === "pas_interesse") out.not_interested++;
      if (c.outcome === "faux_numero") out.wrong++;
      const v = l.brief?.verdict || "autre";
      const row = out.by_verdict[v] || (out.by_verdict[v] = { label: l.brief?.verdict_label || "Autre", calls: 0, reached: 0, rdv: 0 });
      row.calls++;
      if (REACHED.has(c.outcome)) row.reached++;
      if (c.outcome === "rdv") row.rdv++;
    }
    if (touched) out.leads_called++;
  }
  out.reach_rate = out.calls ? Math.round((out.reached / out.calls) * 100) : 0;
  out.rdv_rate = out.reached ? Math.round((out.rdv / out.reached) * 100) : 0;
  out.by_day = days.map((d, i) => ({ day: d, label: DAY_LABELS[i], calls: perDay[d] }))
    .filter((r, i) => i < 5 || r.calls > 0); // week-end affiché seulement s'il y a eu des appels
  return out;
}
