// Agenda Outlook en lecture seule, via un flux ICS publié.
//
// Choix d'architecture : on NE passe PAS par Microsoft Graph. Les permissions
// Mail/Calendars d'un tenant Microsoft 365 d'entreprise exigent le consentement
// d'un administrateur — inaccessible à un salarié. Publier son calendrier en ICS
// est une action utilisateur, sans OAuth et sans droit d'écriture.
//
// Configuration (variables d'environnement Vercel, jamais en base ni en dur) :
// - OUTLOOK_ICS_URL      : url du flux publié. À traiter comme un SECRET :
//                          quiconque la possède lit l'agenda.
// - CALENDAR_SELF_EMAIL  : (option) ton adresse, pour masquer les invitations
//                          que tu as refusées.
// - CALENDAR_TZ          : (option) fuseau de repli, « Europe/Paris » par défaut.

import { getSupabase } from "@/lib/supabase";
import { parseIcs } from "@/lib/ics";

const CACHE_TTL_MS = 10 * 60 * 1000; // le flux ICS d'Outlook n'est lui-même rafraîchi qu'aux ~15 min
const FETCH_TIMEOUT_MS = 6000;

// Cache mémoire volontairement simple : pas de table, donc pas de migration.
// Sur Vercel il vit le temps d'une instance chaude — c'est suffisant pour éviter
// de retélécharger le flux à chaque navigation.
let cache = null; // { url, at, text }

export function isCalendarConfigured() {
  return !!(process.env.OUTLOOK_ICS_URL || "").trim();
}

async function fetchIcsText(url, { force = false } = {}) {
  if (!force && cache && cache.url === url && Date.now() - cache.at < CACHE_TTL_MS) {
    return { text: cache.text, cached: true };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.8" },
    });
    if (!res.ok) throw new Error(`Le flux a répondu ${res.status}.`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error("La réponse n'est pas un calendrier iCalendar (url de publication incorrecte ?).");
    }
    cache = { url, at: Date.now(), text };
    return { text, cached: false };
  } finally {
    clearTimeout(timer);
  }
}

// ── Rapprochement événement ↔ compte ─────────────────────────────────────────

const STOP_WORDS = new Set(["group", "groupe", "france", "sa", "sas", "sarl", "se", "plc", "inc", "ltd", "the"]);

const normalize = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Domaine exploitable d'un compte : « www.acme.fr » → « acme.fr ».
const cleanDomain = (d) =>
  String(d || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim();

// Domaines génériques : une adresse gmail ne rattache évidemment aucun compte.
const GENERIC_DOMAINS = new Set([
  "gmail.com", "outlook.com", "hotmail.com", "yahoo.fr", "yahoo.com",
  "orange.fr", "free.fr", "wanadoo.fr", "icloud.com", "live.fr", "sfr.fr",
]);

/**
 * Associe chaque événement à un compte, par ordre de fiabilité décroissante :
 * 1. le domaine d'un participant correspond au domaine du compte (fiable) ;
 * 2. le nom du compte apparaît dans le titre ou le lieu (heuristique).
 * Le mode de rapprochement est renvoyé pour que l'interface reste honnête.
 */
export function matchEventsToAccounts(events, accounts) {
  const byDomain = new Map();
  const byName = [];
  for (const a of accounts || []) {
    const dom = cleanDomain(a.domain);
    if (dom && !GENERIC_DOMAINS.has(dom)) byDomain.set(dom, a);
    const tokens = normalize(a.name).split(" ").filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
    if (tokens.length) byName.push({ account: a, needle: tokens.join(" ") });
  }

  return events.map((ev) => {
    const emails = [ev.organizer, ...(ev.attendees || [])].filter(Boolean);
    for (const email of emails) {
      const dom = email.split("@")[1];
      if (!dom || GENERIC_DOMAINS.has(dom)) continue;
      // Rattache aussi les sous-domaines (it.acme.fr → acme.fr).
      for (const [accountDomain, account] of byDomain) {
        if (dom === accountDomain || dom.endsWith(`.${accountDomain}`)) {
          return { ...ev, account_id: account.id, account_name: account.name, match: "domaine" };
        }
      }
    }
    const hay = `${normalize(ev.title)} ${normalize(ev.location)}`;
    for (const { account, needle } of byName) {
      if (hay.includes(needle)) {
        return { ...ev, account_id: account.id, account_name: account.name, match: "titre" };
      }
    }
    return { ...ev, account_id: null, account_name: "", match: "" };
  });
}

// ── Point d'entrée ───────────────────────────────────────────────────────────

/**
 * Prochains rendez-vous de l'agenda publié, rapprochés des comptes du CRM.
 * Ne lève jamais : un agenda indisponible ne doit pas casser la page Agenda.
 * @returns {{configured:boolean, events:Array, error:string, cached:boolean}}
 */
export async function getCalendar(supabase = getSupabase(), { days = 14, force = false } = {}) {
  const url = (process.env.OUTLOOK_ICS_URL || "").trim();
  if (!url) return { configured: false, events: [], error: "", cached: false };

  try {
    const { text, cached } = await fetchIcsText(url, { force });

    const now = Date.now();
    const from = new Date(new Date(now).toDateString()).getTime(); // début de la journée en cours
    const to = now + days * 86400000;

    const parsed = parseIcs(text, {
      from, to,
      defaultTz: (process.env.CALENDAR_TZ || "Europe/Paris").trim(),
      selfEmail: (process.env.CALENDAR_SELF_EMAIL || "").trim(),
    });

    const kept = parsed.filter((ev) => {
      if (ev.cancelled) return false;
      if (ev.selfStatus === "DECLINED") return false;
      // Anniversaires, jours fériés, congés posés en « libre » : du bruit.
      if (ev.allDay && ev.transparent) return false;
      return true;
    });

    const { data: accounts } = await supabase.from("accounts").select("id, name, domain");
    return { configured: true, events: matchEventsToAccounts(kept, accounts || []), error: "", cached };
  } catch (e) {
    const msg = e?.name === "AbortError"
      ? "L'agenda n'a pas répondu dans les temps."
      : e?.message || "Agenda indisponible.";
    return { configured: true, events: [], error: msg, cached: false };
  }
}
