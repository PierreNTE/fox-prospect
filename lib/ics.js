// Lecteur de flux iCalendar (RFC 5545) — sans dépendance externe.
//
// Pourquoi ce fichier plutôt qu'une intégration Microsoft Graph : publier son
// agenda Outlook en ICS ne demande AUCUN consentement administrateur, là où
// Graph exige l'accord de la DSI du tenant. On lit, on n'écrit jamais.
//
// Limites assumées (documentées plutôt que masquées) :
// - les exceptions d'occurrence (RECURRENCE-ID) ne sont pas appliquées : une
//   réunion récurrente déplacée une seule fois apparaîtra à son heure d'origine ;
// - les règles de récurrence exotiques (BYSETPOS, nième jour du mois) retombent
//   sur le jour de la première occurrence ;
// - les fuseaux sont résolus via Intl ; un TZID Windows inconnu retombe sur le
//   fuseau par défaut passé en option.

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// Outlook émet des identifiants de fuseau Windows, pas des noms IANA.
// On mappe les plus probables pour un agenda français d'un groupe américain.
const WIN_TZ = {
  "Romance Standard Time": "Europe/Paris",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Warsaw",
  "Central European Standard Time": "Europe/Belgrade",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "UTC",
  UTC: "UTC",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Singapore Standard Time": "Asia/Singapore",
};

// ── Fuseaux ──────────────────────────────────────────────────────────────────

// Décalage (ms) du fuseau `tz` à l'instant `ts`. Astuce standard : on reformate
// l'instant dans le fuseau cible et on compare aux champs interprétés en UTC.
function tzOffsetMs(ts, tz) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p = {};
    for (const { type, value } of dtf.formatToParts(ts)) p[type] = value;
    // hour12:false peut rendre "24" à minuit selon les runtimes.
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUtc - ts;
  } catch {
    return 0; // fuseau inconnu d'Intl → traité comme UTC
  }
}

// Convertit des champs calendaires locaux (y/mo/d h:mi:s dans `tz`) en instant
// UTC. Deux itérations suffisent à converger, y compris autour d'un changement
// d'heure.
function zonedToUtc({ y, mo, d, h = 0, mi = 0, s = 0 }, tz) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = wall;
  for (let i = 0; i < 2; i++) ts = wall - tzOffsetMs(ts, tz);
  return ts;
}

// Instant UTC correspondant à des champs de date, selon leur nature.
function partsToTs(parts, defaultTz) {
  if (!parts) return NaN;
  if (parts.utc) return Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s);
  const tz = WIN_TZ[parts.tzid] || parts.tzid || defaultTz;
  return zonedToUtc(parts, tz);
}

// ── Découpage du flux ────────────────────────────────────────────────────────

// Déplie les lignes repliées (RFC 5545 §3.1 : une continuation commence par un
// espace ou une tabulation) et normalise les fins de ligne.
function unfold(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "");
}

// "DTSTART;TZID=Romance Standard Time:20260724T090000"
//   → { name: "DTSTART", params: { TZID: "Romance Standard Time" }, value: "20260724T090000" }
function parseLine(line) {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segs = head.split(";");
  const name = segs[0].toUpperCase();
  const params = {};
  for (const seg of segs.slice(1)) {
    const eq = seg.indexOf("=");
    if (eq < 0) continue;
    params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

// Déséchappe une valeur texte (RFC 5545 §3.3.11).
function unescapeText(v) {
  return String(v || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

// "20260724" | "20260724T090000Z" | "20260724T090000"
function parseDateParts(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  return {
    y: +m[1], mo: +m[2], d: +m[3],
    h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, s: m[6] ? +m[6] : 0,
    utc: m[7] === "Z",
    allDay: !m[4] || params.VALUE === "DATE",
    tzid: params.TZID || "",
  };
}

// "mailto:jean@acme.fr" → "jean@acme.fr"
function parseMailto(v) {
  return String(v || "").replace(/^mailto:/i, "").trim().toLowerCase();
}

function parseRRule(v) {
  const out = { interval: 1 };
  for (const part of String(v).split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).toUpperCase();
    const val = part.slice(eq + 1);
    if (k === "FREQ") out.freq = val.toUpperCase();
    else if (k === "INTERVAL") out.interval = Math.max(1, parseInt(val, 10) || 1);
    else if (k === "COUNT") out.count = parseInt(val, 10) || 0;
    else if (k === "UNTIL") out.untilParts = parseDateParts(val);
    else if (k === "BYDAY") {
      out.byday = val.split(",")
        .map((d) => d.trim().slice(-2).toUpperCase())
        .filter((d) => DAY_CODES.includes(d));
    } else if (k === "BYMONTHDAY") {
      out.bymonthday = val.split(",").map((n) => parseInt(n, 10)).filter(Number.isFinite);
    }
  }
  return out.freq ? out : null;
}

// ── Récurrence ───────────────────────────────────────────────────────────────

const addDaysParts = (p, n) => {
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
  return { ...p, y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};

// Ajoute des mois en bornant le quantième (31 janvier + 1 mois → 28/29 février).
const addMonthsParts = (p, n) => {
  const y = p.y + Math.floor((p.mo - 1 + n) / 12);
  const mo = ((((p.mo - 1 + n) % 12) + 12) % 12) + 1;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { ...p, y, mo, d: Math.min(p.d, lastDay) };
};

const dowOf = (p) => new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();

// Développe une récurrence en instants de début, bornés à [from, to].
// On raisonne sur les champs calendaires locaux puis on reconvertit : l'heure
// de la réunion reste la même de part et d'autre d'un changement d'heure.
function expandRecurrence(startParts, rrule, defaultTz, from, to, maxOcc = 200) {
  const first = partsToTs(startParts, defaultTz);
  if (!rrule) return Number.isFinite(first) ? [first] : [];

  const untilTs = rrule.untilParts ? partsToTs(rrule.untilParts, defaultTz) : Infinity;
  const limit = Math.min(to, Number.isFinite(untilTs) ? untilTs : Infinity);
  const out = [];
  let emitted = 0; // compte TOUTES les occurrences, y compris avant `from` (COUNT)
  let guard = 0;

  const push = (parts) => {
    const ts = partsToTs(parts, defaultTz);
    if (!Number.isFinite(ts) || ts < first) return true;
    if (ts > limit) return false;
    emitted += 1;
    if (rrule.count && emitted > rrule.count) return false;
    if (ts >= from) out.push(ts);
    return true;
  };

  if (rrule.freq === "WEEKLY" && rrule.byday?.length) {
    // Semaine de référence : celle de la première occurrence, base dimanche.
    let week = addDaysParts(startParts, -dowOf(startParts));
    while (guard++ < 600 && out.length < maxOcc) {
      let alive = false;
      for (const code of rrule.byday) {
        const cand = addDaysParts(week, DAY_CODES.indexOf(code));
        const ts = partsToTs(cand, defaultTz);
        if (ts > limit || (rrule.count && emitted >= rrule.count)) { alive = false; break; }
        if (!push(cand)) { alive = false; break; }
        alive = true;
      }
      if (!alive && (partsToTs(week, defaultTz) > limit || (rrule.count && emitted >= rrule.count))) break;
      week = addDaysParts(week, 7 * rrule.interval);
      if (partsToTs(week, defaultTz) > limit) break;
    }
    return out.sort((a, b) => a - b);
  }

  const step = { DAILY: 1, WEEKLY: 7 }[rrule.freq];
  let cur = { ...startParts };
  while (guard++ < 600 && out.length < maxOcc) {
    if (!push(cur)) break;
    if (step) cur = addDaysParts(cur, step * rrule.interval);
    else if (rrule.freq === "MONTHLY") cur = addMonthsParts(cur, rrule.interval);
    else if (rrule.freq === "YEARLY") cur = addMonthsParts(cur, 12 * rrule.interval);
    else break; // fréquence non gérée → occurrence unique
  }
  return out.sort((a, b) => a - b);
}

// ── API publique ─────────────────────────────────────────────────────────────

/**
 * Parse un flux ICS et renvoie les occurrences comprises dans [from, to].
 * @returns {Array<{uid,title,start,end,allDay,location,organizer,attendees,
 *                  transparent,cancelled,selfStatus,recurring}>}
 */
export function parseIcs(text, { from = 0, to = Infinity, defaultTz = "Europe/Paris", selfEmail = "" } = {}) {
  const lines = unfold(text).split("\n");
  const events = [];
  let cur = null;
  let depth = 0; // ignore les sous-composants (VALARM, VTIMEZONE…)

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line === "BEGIN:VEVENT") { cur = { attendees: [], exdates: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (line === "END:VEVENT") { events.push(cur); cur = null; continue; }
    if (line.startsWith("BEGIN:")) { depth += 1; continue; }
    if (line.startsWith("END:")) { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) continue;

    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case "UID": cur.uid = p.value.trim(); break;
      case "SUMMARY": cur.title = unescapeText(p.value); break;
      case "LOCATION": cur.location = unescapeText(p.value); break;
      case "DTSTART": cur.startParts = parseDateParts(p.value, p.params); break;
      case "DTEND": cur.endParts = parseDateParts(p.value, p.params); break;
      case "DURATION": cur.duration = p.value.trim(); break;
      case "RRULE": cur.rrule = parseRRule(p.value); break;
      case "EXDATE":
        for (const v of p.value.split(",")) {
          const parts = parseDateParts(v, p.params);
          if (parts) cur.exdates.push(partsToTs(parts, defaultTz));
        }
        break;
      case "STATUS": cur.status = p.value.trim().toUpperCase(); break;
      case "TRANSP": cur.transp = p.value.trim().toUpperCase(); break;
      case "ORGANIZER": cur.organizer = parseMailto(p.value); break;
      case "ATTENDEE": {
        const email = parseMailto(p.value);
        if (email) cur.attendees.push({ email, partstat: (p.params.PARTSTAT || "").toUpperCase() });
        break;
      }
      default: break;
    }
  }

  const self = String(selfEmail || "").trim().toLowerCase();
  const out = [];

  for (const ev of events) {
    if (!ev.startParts) continue;
    const startTs = partsToTs(ev.startParts, defaultTz);
    const endTs = ev.endParts ? partsToTs(ev.endParts, defaultTz) : NaN;
    // Durée : DTEND si présent, sinon 1 journée (all-day) ou 1 heure.
    const dur = Number.isFinite(endTs) && endTs > startTs
      ? endTs - startTs
      : (ev.startParts.allDay ? 86400000 : 3600000);

    const exdates = new Set(ev.exdates);
    const occurrences = expandRecurrence(ev.startParts, ev.rrule, defaultTz, from, to);
    const selfEntry = self ? ev.attendees.find((a) => a.email === self) : null;

    for (const ts of occurrences) {
      if (exdates.has(ts)) continue;
      if (ts + dur < from || ts > to) continue;
      out.push({
        uid: ev.uid || "",
        title: ev.title || "(sans titre)",
        start: new Date(ts).toISOString(),
        end: new Date(ts + dur).toISOString(),
        allDay: !!ev.startParts.allDay,
        location: ev.location || "",
        organizer: ev.organizer || "",
        attendees: ev.attendees.map((a) => a.email),
        transparent: ev.transp === "TRANSPARENT",
        cancelled: ev.status === "CANCELLED",
        selfStatus: selfEntry ? selfEntry.partstat : "",
        recurring: !!ev.rrule,
      });
    }
  }

  return out.sort((a, b) => a.start.localeCompare(b.start));
}
