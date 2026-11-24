// Retour de l'agent Sales Chat : Pierre colle le récapitulatif de l'agent
// (tableau principal, « Emails trouvés », « Rebonds », « Nouveaux STOP ») et
// l'appli met les leads à jour en une fois. Fonctions pures, testées : le
// texte collé peut venir d'un tableau Markdown (« | »), d'un tableau copié
// depuis l'interface (tabulations) ou d'une liste avec « · ».
import { normalizeName } from "@/lib/company-health";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const DRAFTED_RE = /brouillon|pr[êe]t [àa] envoyer|valid[ée]|planifi[ée]|envoy[ée]/i;
const LEGAL = /\b(SAS|SASU|SARL|EURL|SA|SCI|SNC|SCOP|SELARL|GIE|EARL|SCA|ETS|STE|SOCIETE)\b/g;

const cells = (line) =>
  line.split(/\t|\s*\|\s*|\s+·\s+/).map((c) => c.replace(/\*\*/g, "").trim()).filter(Boolean);

const section = (line) => {
  const l = line.toLowerCase();
  if (/emails?\s+trouv/.test(l)) return "found";
  if (/^\W*rebonds?\b/.test(l)) return "bounces";
  if (/nouveaux\s+stop|ne plus .*contact/.test(l) && !EMAIL_RE.test(line)) return "stops";
  if (/^\W*(non vérifié|bilan|\d+ prêts?)/i.test(l)) return "other";
  return null;
};

/** Nom comparable : sans forme juridique ni ponctuation. */
export function companyKey(name) {
  return normalizeName(String(name || "").replace(/\./g, "")).replace(LEGAL, " ").replace(/\s+/g, " ").trim();
}

/**
 * @returns {{ rows: {societe:string,email:string,statut:string,raison:string,drafted:boolean}[],
 *            found: {societe:string,email:string,source:string}[], bounces: string[], stops: {email:string,societe:string}[] }}
 */
export function parseAgentRecap(text) {
  const out = { rows: [], found: [], bounces: [], stops: [] };
  let where = "main";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[|:\-\s]+$/.test(line)) continue;            // séparateurs de tableau Markdown
    const s = section(line);
    if (s) { where = s; continue; }
    const c = cells(line);
    if (/^(n°|société|societe|email)$/i.test(c[0] || "") || /^société$/i.test(c[1] || "")) continue; // en-têtes
    const email = (line.match(EMAIL_RE) || [""])[0].toLowerCase();
    if (where === "main") {
      const statusCell = c.find((x) => /brouillon|pr[êe]t|valid|ignor|rebond|planifi|envoy/i.test(x));
      if (!statusCell) continue;
      const rest = /^\d+$/.test(c[0]) ? c.slice(1) : c;
      const societe = rest.find((x) => !EMAIL_RE.test(x) && x !== statusCell && !/^(sûr|probable|supposé|à trouver)$/i.test(x)) || "";
      const idx = c.indexOf(statusCell);
      out.rows.push({ societe, email, statut: statusCell, raison: c.slice(idx + 1).join(" "), drafted: DRAFTED_RE.test(statusCell) && !/ignor/i.test(statusCell) });
    } else if (where === "found" && email) {
      const others = c.filter((x) => !EMAIL_RE.test(x));
      out.found.push({ societe: others[0] || "", email, source: others.slice(1).join(" ") });
    } else if (where === "bounces" && email) {
      out.bounces.push(email);
    } else if (where === "stops") {
      const others = c.filter((x) => !EMAIL_RE.test(x) && !/^[-•*]$/.test(x));
      if (email || others[0]) out.stops.push({ email, societe: email ? (others[0] || "") : others[0].replace(/^[-•*]\s*/, "") });
    }
  }
  return out;
}

/**
 * Traduit le récapitulatif en mises à jour des leads (pur, testé).
 * leads : { id, name, sirene_name, found_email, found_email_source, email (pickEmail), bounced_emails }
 */
export function planRecapUpdates(recap, leads) {
  const byKey = new Map();
  for (const l of leads) {
    for (const n of [l.name, l.sirene_name]) if (n) byKey.set(companyKey(n), l);
  }
  const byEmail = new Map();
  for (const l of leads) {
    for (const e of [l.email?.email, l.found_email]) if (e) byEmail.set(String(e).toLowerCase(), l);
  }
  const domainOf = (e) => String(e).split("@")[1] || "";
  const find = (societe, email) =>
    (email && byEmail.get(email)) || (societe && byKey.get(companyKey(societe)))
    || (email && leads.find((l) => l.email?.email && domainOf(l.email.email) === domainOf(email) && !/gmail|orange|wanadoo|free|outlook|hotmail|yahoo|laposte|sfr/.test(domainOf(email))));

  const updates = new Map(); // id → patch
  const patch = (l, p) => updates.set(l.id, { ...(updates.get(l.id) || {}), ...p });
  const unmatched = [];
  const now = new Date().toISOString();

  for (const r of recap.rows) {
    const l = find(r.societe, r.email);
    if (!l) { unmatched.push(r.societe || r.email); continue; }
    if (r.drafted) patch(l, { email_exported_at: now });
  }
  for (const f of recap.found) {
    const l = find(f.societe, null) || find(null, f.email);
    if (!l) { unmatched.push(f.societe || f.email); continue; }
    if (l.found_email_source !== "manuel") {
      patch(l, { found_email: f.email, found_email_source: `agent Sales Chat${f.source ? ` (${f.source.slice(0, 120)})` : ""}` });
    }
  }
  for (const e of recap.bounces) {
    const l = find(null, e);
    if (!l) { unmatched.push(e); continue; }
    const list = [...new Set([...(l.bounced_emails || []), ...(updates.get(l.id)?.bounced_emails || []), e])];
    patch(l, { bounced_emails: list, ...(String(l.found_email || "").toLowerCase() === e ? { found_email: null, found_email_source: null } : {}) });
  }
  for (const s of recap.stops) {
    const l = find(s.societe, s.email);
    if (!l) { unmatched.push(s.societe || s.email); continue; }
    patch(l, { email_opt_out: true });
  }
  return { updates: [...updates.entries()].map(([id, p]) => ({ id, ...p })), unmatched: [...new Set(unmatched.filter(Boolean))] };
}
