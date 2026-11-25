// Suivi des emails envoyés : Pierre colle la liste de ses emails envoyés
// (retour de l'agent Sales Chat « suivi des envois », ou copie / export des
// Éléments envoyés d'Outlook). L'appli rattache chaque envoi à son lead,
// l'enregistre une seule fois et signale les erreurs : doublon, société en STOP,
// lead clos, adresse douteuse, non remis, réponse reçue.
// Fonctions pures, testées dans tests/sent-emails.test.js.
import { parseCsv } from "./salesforce-report.js";
import { assessEmail, emailContext, WEBMAIL, domainBase } from "./email-quality.js";

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Adresses internes : jamais enregistrées (collègues Dell, partenaires internes).
const INTERNAL = /(^|[.@])(dell|dellteam|emc)\.com$/i;
export const RESEND_DAYS = 25;

export const SENT_STATUS = {
  envoye: { label: "Envoyé", color: "informative", rank: 0 },
  reponse: { label: "A répondu", color: "success", rank: 1 },
  non_remis: { label: "Non remis", color: "danger", rank: 2 },
  stop: { label: "STOP", color: "danger", rank: 3 },
};

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9@.]+/g, " ").trim();

export function normalizeStatus(s) {
  const v = norm(s);
  if (/stop|desinscri|unsubscribe|ne plus/.test(v)) return "stop";
  if (/non remis|undeliver|ndr|echec|erreur|bounce|rebond|delivery fail|introuvable/.test(v)) return "non_remis";
  if (/repon|reply|replied|repondu|answered/.test(v)) return "reponse";
  return "envoye";
}

const pad = (n) => String(n).padStart(2, "0");

/** « 2026-11-25 14:32 », « mer. 25/11/2026 14:32 », « 25/11/2026 », « 25.11.26 » → ISO (heure de Paris approximée). */
export function parseSentDate(s) {
  const v = String(s || "").trim();
  let m = v.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${pad(m[4] || 12)}:${m[5] || "00"}:00`;
  m = v.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})(?:\D+(\d{1,2})[:h](\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    let [d, mo] = [Number(m[1]), Number(m[2])];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // format américain mm/jj
    let h = Number(m[4] || 12);
    if (/pm/i.test(v) && h < 12) h += 12;
    return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${m[5] || "00"}:00`;
  }
  return null;
}

// Intitulés de colonnes reconnus (agent Sales Chat, Outlook FR / EN).
const COLS = {
  date: /^(date( d.envoi)?|envoy[ée]( le)?|date envoi|sent|date sent|sent on|reçu|received|date de remise)$/i,
  to_email: /^(email|e-mail|adresse|destinataire \(email\)|email destinataire|[àa]\s*:\s*\(adresse\)|to\s*:\s*\(address\)|to address)$/i,
  to: /^([àa]|to|destinataire|destinataires|recipient|recipients|[àa]\s*:\s*\(nom\)|to\s*:\s*\(name\))$/i,
  name: /^(nom|name|nom du destinataire|contact)$/i,
  subject: /^(objet|subject|sujet)$/i,
  status: /^(statut|status|état|etat|suivi)$/i,
  company: /^(société|societe|company|entreprise)$/i,
};

/** Texte collé (CSV, tableau Markdown, copie Outlook) → { headers, rows }. */
function toTable(text) {
  const lines = String(text || "").replace(/```[a-z]*\n?/gi, "").split(/\r?\n/)
    .filter((l) => l.trim() && !/^[|:\-\s]+$/.test(l));
  const md = lines.filter((l) => l.trim().startsWith("|")).length >= Math.max(2, lines.length / 2);
  const src = md ? lines.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("\t")).join("\n") : lines.join("\n");
  return parseCsv(src);
}

/**
 * @returns {{ rows: {sent_at:string|null, to_email:string, to_name:string, subject:string, status:string, company:string}[],
 *            internal: number, columns: string[] }}
 */
export function parseSentEmails(text) {
  const { headers, rows } = toTable(text);
  const head = headers.map((h) => String(h || "").trim());
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, re]) => [k, head.findIndex((h) => re.test(h))]));
  const hasHeader = Object.values(idx).some((i) => i >= 0);
  const body = hasHeader ? rows : [head, ...rows];
  const get = (r, k) => (idx[k] >= 0 ? String(r[idx[k]] || "") : "");
  const out = [];
  let internal = 0;
  for (const r of body) {
    const line = r.join(" \t ");
    const toCell = [get(r, "to_email"), get(r, "to")].filter(Boolean).join(" ; ");
    let emails = [...new Set((toCell.match(EMAIL_RE) || (hasHeader ? [] : line.match(EMAIL_RE)) || []).map((e) => e.toLowerCase().replace(/^'+|'+$/g, "")))];
    // Nom affiché (copie Outlook « À : Jean Martin ») : gardé pour le rapprochement.
    const nameCell = get(r, "name") || (idx.to >= 0 && idx.to !== idx.to_email ? get(r, "to") : "");
    const displayName = nameCell.replace(/<[^>]*>|[\w.%+'-]+@[\w.-]+\.\w+|["']/g, "").split(/[;,]/)[0].trim();
    if (!emails.length && !displayName) continue;
    const before = emails.length;
    emails = emails.filter((e) => !INTERNAL.test(e) && !INTERNAL.test(e.split("@")[1] || ""));
    internal += before - emails.length;
    if (before && !emails.length) continue;
    const sent = parseSentDate(get(r, "date") || (hasHeader ? "" : line));
    const base = {
      sent_at: sent, subject: get(r, "subject").slice(0, 200), to_name: displayName.slice(0, 120),
      status: normalizeStatus(get(r, "status")), company: get(r, "company").slice(0, 160),
    };
    if (!emails.length) out.push({ ...base, to_email: "" });
    for (const e of emails) out.push({ ...base, to_email: e });
  }
  return { rows: out, internal, columns: hasHeader ? head : [] };
}

const nameKey = (s) => norm(s).replace(/[^a-z ]/g, "").split(" ").filter(Boolean).sort().join(" ");
const subjectKey = (s) => norm(s).replace(/^(re|tr|fw|fwd)\s*:?\s*/g, "").slice(0, 80);
const dayOf = (iso) => String(iso || "").slice(0, 10);
export const dedupKey = (r) => `${r.to_email || nameKey(r.to_name)}|${subjectKey(r.subject)}|${dayOf(r.sent_at)}`;

/** Toutes les adresses connues d'un lead (email choisi, trouvé, contacts). */
function leadEmails(l) {
  return [l.email?.email, l.found_email, l.contact?.email, ...((l.emails_sent || []).map((e) => e.to))]
    .filter(Boolean).map((e) => String(e).toLowerCase());
}

function leadDomains(l) {
  const ctx = emailContext(l);
  const own = new Set(ctx.domains.map(domainBase));
  for (const e of leadEmails(l)) {
    const d = e.split("@")[1];
    if (d && !WEBMAIL.has(d)) own.add(domainBase(d));
  }
  return own;
}

/**
 * Rattache les envois aux leads et liste les erreurs (pur, testé).
 * leads : sortie de listSalesforceLeads (email, found_email, contact, recipient, emails_sent…)
 * @returns {{ entries, updates, issues, unmatched: string[] }}
 */
export function planSentEmails(rows, leads, { now = new Date().toISOString() } = {}) {
  const byEmail = new Map();
  const byDomain = new Map();
  const byName = new Map();
  for (const l of leads || []) {
    for (const e of leadEmails(l)) byEmail.set(e, l);
    for (const d of leadDomains(l)) if (!byDomain.has(d)) byDomain.set(d, l); else if (byDomain.get(d) !== l) byDomain.set(d, null);
    for (const n of [l.recipient?.name, l.contact?.name]) if (n) byName.set(nameKey(n), byName.has(nameKey(n)) && byName.get(nameKey(n)) !== l ? null : l);
  }
  const find = (r) => {
    if (r.to_email && byEmail.has(r.to_email)) return byEmail.get(r.to_email);
    const d = r.to_email.split("@")[1];
    if (d && !WEBMAIL.has(d) && byDomain.get(domainBase(d))) return byDomain.get(domainBase(d));
    if (r.to_name && byName.get(nameKey(r.to_name))) return byName.get(nameKey(r.to_name));
    return null;
  };

  const entries = new Map();
  const issues = [];
  const updates = new Map();
  const unmatched = [];
  const patch = (l, p) => updates.set(l.id, { ...(updates.get(l.id) || {}), ...p });
  const issue = (kind, l, r, detail) => issues.push({ kind, lead_id: l?.id || null, lead: l?.name || "", email: r.to_email || r.to_name, detail });

  for (const r0 of rows || []) {
    const r = { ...r0, sent_at: r0.sent_at || now };
    const l = find(r);
    if (!l) { unmatched.push(r.to_email || r.to_name); continue; }
    const key = dedupKey(r);
    const prev = entries.get(key);
    if (prev) {
      // Même envoi collé deux fois : on garde le statut le plus avancé (réponse, non remis…).
      if (SENT_STATUS[r.status].rank > SENT_STATUS[prev.status].rank) prev.status = r.status;
      continue;
    }
    entries.set(key, { account_id: l.id, lead_name: l.name, to_email: r.to_email, to_name: r.to_name, subject: r.subject,
      sent_at: r.sent_at, status: r.status, dedup_key: key, date_known: !!r0.sent_at });
  }

  // Contrôles par lead (sur l'historique + cet import).
  const byLead = new Map();
  for (const e of entries.values()) {
    if (!byLead.has(e.account_id)) byLead.set(e.account_id, []);
    byLead.get(e.account_id).push(e);
  }
  const leadById = new Map((leads || []).map((l) => [l.id, l]));
  for (const [id, list] of byLead) {
    const l = leadById.get(id);
    const sends = list.filter((e) => e.status === "envoye" || e.status === "reponse" || e.status === "non_remis");
    const history = (l.emails_sent || []).filter((h) => !list.some((e) => e.dedup_key === h.key));
    const all = [...history.map((h) => ({ sent_at: h.at, to_email: h.to })), ...sends]
      .sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
    for (let i = 1; i < all.length; i++) {
      const gap = (Date.parse(all[i].sent_at) - Date.parse(all[i - 1].sent_at)) / 86400000;
      if (gap < RESEND_DAYS && list.some((e) => e.sent_at === all[i].sent_at)) {
        issue("doublon", l, all[i], `deuxième envoi en ${Math.max(0, Math.round(gap))} jour(s)${all[i].to_email !== all[i - 1].to_email ? " (autre adresse)" : ""}`);
      }
    }
    for (const e of list) {
      if (l.email_opt_out && e.status !== "stop") issue("stop", l, e, "société en STOP : elle ne devait plus recevoir d'email");
      if (!(["active", "vigilance"].includes(l.health_status)) || /closed|rejected/i.test(l.sf_lead_status || "")) {
        issue("clos", l, e, "lead clos dans Salesforce ou société fermée");
      }
      if (["rdv", "pas_interesse"].includes(l.call_status)) issue("traite", l, e, l.call_status === "rdv" ? "RDV déjà pris" : "a dit « pas intéressé » au téléphone");
      if (e.to_email) {
        const q = assessEmail(e.to_email, emailContext(l));
        if (!q.ok && !leadEmails(l).includes(e.to_email)) issue("adresse", l, e, `adresse douteuse : ${q.reason}`);
      }
      if (!e.date_known) issue("date", l, e, "date d'envoi absente : date de l'import utilisée");
      if (e.status === "non_remis" && e.to_email) {
        patch(l, {
          bounced_emails: [...new Set([...(l.bounced_emails || []), ...(updates.get(l.id)?.bounced_emails || []), e.to_email])],
          ...(String(l.found_email || "").toLowerCase() === e.to_email ? { found_email: null, found_email_source: null } : {}),
        });
        issue("non_remis", l, e, "email non remis : adresse écartée");
      }
      if (e.status === "stop") { patch(l, { email_opt_out: true }); issue("stop_recu", l, e, "a demandé à ne plus recevoir d'email"); }
      if (e.status === "reponse") issue("reponse", l, e, "a répondu : à rappeler en priorité");
    }
  }
  return {
    entries: [...entries.values()],
    updates: [...updates.entries()].map(([id, p]) => ({ id, ...p })),
    issues,
    unmatched: [...new Set(unmatched.filter(Boolean))],
  };
}

export const ISSUE_LABELS = {
  doublon: "Doublons", stop: "Envoyés malgré un STOP", clos: "Leads clos", traite: "Déjà traités au téléphone",
  adresse: "Adresses douteuses", non_remis: "Non remis", stop_recu: "STOP reçus", reponse: "Réponses reçues",
  date: "Dates manquantes",
};
export const ISSUE_ORDER = ["stop", "doublon", "clos", "traite", "adresse", "non_remis", "stop_recu", "reponse", "date"];

/** Résumé des envois d'un lead pour la liste (pur). log : [{ to_email, sent_at, status, dedup_key }]. */
export function sentSummary(log) {
  const list = [...(log || [])].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
  const last = list[list.length - 1];
  return {
    emails_sent: list.slice(-10).map((e) => ({ to: e.to_email, at: e.sent_at, status: e.status, key: e.dedup_key })),
    last_email_at: last?.sent_at || null,
    email_replied: list.some((e) => e.status === "reponse"),
    email_status: last?.status || null,
  };
}
