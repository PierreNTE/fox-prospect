// « Qui appeler » : pour chaque lead, au moins un point d'entrée.
// Ordre : contacts informatiques trouvés ou saisis, autres contacts, dirigeants
// légaux (RNE), dirigeants de la maison mère, et toujours le standard — son
// numéro s'il est connu, sinon une recherche en un clic.
// Fonction pure (testée) : aucune requête, tout vient de la ligne du compte.

import { assessEmail, emailContext, hardReject } from "./email-quality.js";

export const IT_RE = /informati|\bdsi\b|syst[eè]me|r[ée]seau|infra|\bit\b|\bcto\b|\bcio\b|rssi|num[ée]rique|digital|cyber|cloud/i;

const strip = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** « JEAN-PIERRE DUPONT » → « Jean-Pierre Dupont ». */
export function prettyName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function prettyRole(role) {
  const r = String(role || "").trim();
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : "";
}

const PARTICLES = new Set(["de", "du", "des", "le", "la", "van", "von", "der", "den", "di", "da", "del", "d'"]);

/**
 * Prénom et nom d'usage d'un nom complet du RNE : « MARC ANTOINE DUBOIS » →
 * { first: « Marc », last: « Dubois » } ; « Claire Anne Lemoine (Martin) » → Claire Lemoine.
 */
export function splitName(full) {
  const words = prettyName(String(full || "").replace(/\([^)]*\)/g, " ")).split(" ").filter(Boolean);
  if (!words.length) return { first: "", last: "" };
  if (words.length === 1) return { first: "", last: words[0] };
  let i = words.length - 1;
  while (i > 1 && PARTICLES.has(words[i - 1].toLowerCase())) i--;
  return { first: words[0], last: words.slice(i).join(" ") };
}

const DECIDER_RE = /g[ée]rant|pr[ée]sident|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|\bpdg\b|\bdg\b|fondat|dirigeant|maire|\bdgs\b|directeur des services|secr[ée]taire g[ée]n[ée]ral/i;

/**
 * Destinataire nommé d'un email : informatique d'abord, puis le décideur
 * (dirigeant légal, gérant, président, DGS), puis un autre contact, puis le
 * dirigeant de la maison mère. { name: « Prénom Nom », role, source } ou null.
 */
export function pickRecipient(people = []) {
  const rank = (p) => (p.kind === "it" ? 0 : p.kind === "dirigeant" || DECIDER_RE.test(p.role || "") ? 1 : p.kind === "groupe" ? 3 : 2);
  const named = people.filter((p) => (p.last || p.name) && (p.first || p.name.split(" ").length > 1));
  const best = [...named].sort((a, b) => rank(a) - rank(b))[0];
  if (!best) return null;
  const { first, last } = best.first || best.last ? best : splitName(best.name);
  return { name: [first, last].filter(Boolean).join(" ") || best.name, role: best.role || "", source: best.source || "" };
}

/**
 * Message personnalisé : « Bonjour Prénom Nom, » et, si l'adresse est générique,
 * « À l'attention de Prénom Nom, Poste » en première ligne.
 */
export function personalizeEmail(body, recipient, { generic = false } = {}) {
  const text = String(body || "");
  if (!recipient?.name || !text) return text;
  let out = text.replace(/^\s*Bonjour[^,\n]*,/i, `Bonjour ${recipient.name},`);
  if (!/^\s*Bonjour/i.test(text)) out = `Bonjour ${recipient.name},\n\n${text}`;
  if (generic && !/^À l'attention de/i.test(out)) {
    out = `À l'attention de ${recipient.name}${recipient.role ? `, ${recipient.role}` : ""}\n\n${out}`;
    out = out.replace("à la personne en charge de l'informatique", `à ${recipient.name} ou à la personne en charge de l'informatique`);
  }
  return out;
}

/** Numéro de standard : saisi > site / annuaire > fiche > recherche web > portable. */
export function pickStandard(account = {}) {
  // Numéros marqués « non attribué » au téléphone : jamais reproposés.
  const bad = new Set((account.bad_phones || []).map((n) => String(n).replace(/\D/g, "")));
  const ok = (n) => n && !bad.has(String(n).replace(/\D/g, ""));
  if (ok(account.standard_phone) && account.standard_source === "manuel") {
    return { number: account.standard_phone, source: "saisi par toi" };
  }
  const phones = (account.web_intel?.phones || []).filter((p) => ok(p.number));
  const fixe = phones.find((p) => p.kind === "fixe" || p.kind === "voip");
  if (fixe) return { number: fixe.number, source: "site officiel / annuaire" };
  const prep = account.call_prep?.coordonnees?.standard;
  if (ok(prep)) return { number: prep, source: "fiche" };
  if (ok(account.standard_phone)) return { number: account.standard_phone, source: account.standard_source || "recherche web" };
  const mobile = phones[0];
  if (mobile) return { number: mobile.number, source: "site officiel (portable)" };
  return null;
}

/** Lien de recherche du numéro (Google affiche le téléphone de la fiche entreprise en tête). */
export function phoneSearchUrl(account = {}) {
  const d = account.health_detail || {};
  const name = d.sirene_name || account.name || "";
  const q = [name, d.commune, "téléphone"].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/**
 * @param {{ account: object, contacts?: object[] }} input
 *   account : ligne accounts (name, health_detail, web_intel, call_prep, standard_phone…)
 *   contacts : lignes account_contacts du compte
 * @returns {{ people: object[], standard: {number:string, source:string}|null, phone_search_url: string }}
 */
export function whoToCall({ account = {}, contacts = [] } = {}) {
  const d = account.health_detail || {};
  const seen = new Set();
  const people = [];
  const push = (p) => {
    const key = strip(p.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    people.push(p);
  };

  const found = contacts
    .filter((c) => (c.first_name || c.last_name))
    .map((c) => ({
      id: c.id || null,
      name: prettyName([c.first_name, c.last_name].filter(Boolean).join(" ")),
      first: prettyName(String(c.first_name || "").split(" ")[0]),
      last: prettyName(c.last_name || ""),
      role: prettyRole(c.role),
      phone: c.phone || "",
      email: c.email || "",
      linkedin: c.linkedin_url || "",
      source: c.source || "Contact du compte",
      kind: IT_RE.test(c.role || "") ? "it" : "contact",
    }))
    .sort((a, b) => (Number(b.kind === "it") - Number(a.kind === "it")) || (Number(!!b.phone) - Number(!!a.phone)));
  found.forEach(push);

  for (const x of d.dirigeants || []) {
    push({ id: null, name: prettyName(x.name), ...splitName(x.first || x.last ? `${x.first || ""} ${x.last || ""}` : x.name),
      role: prettyRole(x.role) || "Dirigeant", phone: "", email: "", linkedin: "",
      source: "Dirigeant légal (RNE)", kind: "dirigeant" });
  }
  for (const x of account.web_intel?.groupe_dirigeants || []) {
    push({ id: null, name: prettyName(x.name), ...splitName(x.name), role: `${prettyRole(x.role) || "Dirigeant"}${x.company ? ` de ${x.company}` : ""}`,
      phone: "", email: "", linkedin: "", source: "Dirigeant de la maison mère (RNE)", kind: "groupe" });
  }
  // Fiche plus ancienne : ses interlocuteurs complètent la liste.
  for (const c of account.call_prep?.contacts || []) {
    push({ id: null, name: prettyName([c.prenom, c.nom].filter(Boolean).join(" ")), first: prettyName(String(c.prenom || "").split(" ")[0]),
      last: prettyName(c.nom || ""), role: prettyRole(c.poste), phone: "", email: "",
      linkedin: c.linkedin_url || "", source: c.source || "Fiche", kind: IT_RE.test(c.poste || "") ? "it" : "contact" });
  }

  return { people, standard: pickStandard(account), phone_search_url: phoneSearchUrl(account) };
}

// ── Email à utiliser ─────────────────────────────────────────────────────
// Un email par lead, avec son niveau de confiance :
//   « sûr »     : vu tel quel (site officiel, contact du compte, saisi à la main)
//   « probable » : nominatif construit sur le motif observé sur le site, ou
//                  email vu dans plusieurs résultats de recherche
//   « supposé »  : motif courant (prenom.nom@) sur un domaine qui reçoit des
//                  emails, ou vu dans un seul résultat de recherche
// L'agent d'envoi n'écrit automatiquement qu'aux deux premiers niveaux.
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Raison du rejet de l'email trouvé par la recherche (autre société, recrutement…), ou null. */
export function foundEmailIssue(account = {}) {
  if (!account.found_email || account.found_email_source === "manuel") return null;
  const q = assessEmail(account.found_email, { ...emailContext(account), official: /^annuaire/i.test(account.found_email_source || "") });
  return q.ok ? null : q.reason;
}

export function pickEmail({ account = {}, contacts = [] } = {}) {
  const w = account.web_intel || {};
  const ctx = emailContext(account);
  const cand = [];
  if (account.found_email && account.found_email_source === "manuel") {
    cand.push({ email: account.found_email, name: "", role: "", confidence: "sûr", source: "saisi par toi", manual: true });
  }
  for (const c of contacts) {
    if (c.email) cand.push({ email: c.email, name: prettyName([c.first_name, c.last_name].filter(Boolean).join(" ")), role: c.role || "",
      confidence: "sûr", source: c.source || "contact du compte", it: IT_RE.test(c.role || "") });
  }
  for (const l of w.leaders_emails || []) {
    if (/trouvé/.test(l.confidence || "")) cand.push({ email: l.email, name: prettyName(l.name), role: l.role || "", confidence: "sûr", source: "site officiel" });
    else if (/observé/.test(l.confidence || "")) cand.push({ email: l.email, name: prettyName(l.name), role: l.role || "", confidence: "probable", source: "motif observé sur le site" });
  }
  for (const e of w.emails?.named || []) cand.push({ email: e, name: "", role: "", confidence: "sûr", source: "site officiel" });
  for (const e of w.emails?.generic || []) cand.push({ email: e, name: "", role: "", confidence: "sûr", source: "site officiel (générique)", generic: true });
  if (account.found_email && account.found_email_source !== "manuel") {
    // Contrôle qualité : autre société, recrutement, filiale étrangère, gmail
    // alors que la société a son domaine… → écarté (la recherche repart).
    const official = /^annuaire/i.test(account.found_email_source || "");
    const q = assessEmail(account.found_email, { ...ctx, official });
    if (q.ok) {
      const many = /\b([2-9]|\d{2,}) sources\b/.test(account.found_email_source || "");
      cand.push({ email: account.found_email, name: "", role: "",
        confidence: official ? "sûr" : q.level === "strong" ? "probable" : many ? "probable" : "supposé",
        source: account.found_email_source || "recherche web", generic: q.generic, weak: q.weak_box || q.level !== "strong" });
    }
  }
  for (const l of w.leaders_emails || []) {
    if (!/trouvé|observé/.test(l.confidence || "")) cand.push({ email: l.email, name: prettyName(l.name), role: l.role || "", confidence: "supposé", source: "motif courant, à vérifier" });
  }
  // Dernier recours : le domaine reçoit des emails (MX) → contact@ supposé.
  const domain = account.domain || (w.site?.url ? String(w.site.url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "");
  if (domain && w.dns?.has_mx) cand.push({ email: `contact@${domain}`, name: "", role: "", confidence: "supposé", source: "adresse courante, à vérifier", generic: true });
  const rank = { "sûr": 0, probable: 1, "supposé": 2 };
  const bounced = new Set((account.bounced_emails || []).map((e) => String(e).toLowerCase()));
  const valid = cand.filter((c) => EMAIL_OK.test(c.email || "") && !bounced.has(String(c.email).toLowerCase())
    && (c.manual || !hardReject(c.email, ctx)));
  // Meilleure confiance d'abord ; à confiance égale : informatique, puis nominatif,
  // puis générique ; les boîtes commerciales (commercial@, sav@…) en dernier.
  valid.sort((a, b) => (Number(!!b.manual) - Number(!!a.manual)) || (rank[a.confidence] - rank[b.confidence]) || (Number(!!b.it) - Number(!!a.it))
    || (Number(!!a.weak) - Number(!!b.weak)) || (Number(!!a.generic) - Number(!!b.generic)));
  if (!valid[0]) return null;
  const { manual, it, generic, weak, ...best } = valid[0];
  const local = best.email.split("@")[0].toLowerCase();
  const isGeneric = !!generic || (!best.name && /^(contact|info|infos|accueil|bonjour|hello|mail|office|secretariat|direction|admin|standard|reception|commercial|sales|sav)\b/.test(local));
  return { ...best, email: best.email.toLowerCase(), generic: isGeneric };
}
