// « Qui appeler » : pour chaque lead, au moins un point d'entrée.
// Ordre : contacts informatiques trouvés ou saisis, autres contacts, dirigeants
// légaux (RNE), dirigeants de la maison mère, et toujours le standard — son
// numéro s'il est connu, sinon une recherche en un clic.
// Fonction pure (testée) : aucune requête, tout vient de la ligne du compte.

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

/** Numéro de standard : saisi > site / annuaire > fiche > recherche web > portable. */
export function pickStandard(account = {}) {
  if (account.standard_phone && account.standard_source === "manuel") {
    return { number: account.standard_phone, source: "saisi par toi" };
  }
  const phones = account.web_intel?.phones || [];
  const fixe = phones.find((p) => p.kind === "fixe" || p.kind === "voip");
  if (fixe) return { number: fixe.number, source: "site officiel / annuaire" };
  const prep = account.call_prep?.coordonnees?.standard;
  if (prep) return { number: prep, source: "fiche" };
  if (account.standard_phone) return { number: account.standard_phone, source: account.standard_source || "recherche web" };
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
    push({ id: null, name: prettyName(x.name), role: prettyRole(x.role) || "Dirigeant", phone: "", email: "", linkedin: "",
      source: "Dirigeant légal (RNE)", kind: "dirigeant" });
  }
  for (const x of account.web_intel?.groupe_dirigeants || []) {
    push({ id: null, name: prettyName(x.name), role: `${prettyRole(x.role) || "Dirigeant"}${x.company ? ` de ${x.company}` : ""}`,
      phone: "", email: "", linkedin: "", source: "Dirigeant de la maison mère (RNE)", kind: "groupe" });
  }
  // Fiche plus ancienne : ses interlocuteurs complètent la liste.
  for (const c of account.call_prep?.contacts || []) {
    push({ id: null, name: prettyName([c.prenom, c.nom].filter(Boolean).join(" ")), role: prettyRole(c.poste), phone: "", email: "",
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

export function pickEmail({ account = {}, contacts = [] } = {}) {
  const w = account.web_intel || {};
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
    const many = /\b([2-9]|\d{2,}) sources\b/.test(account.found_email_source || "");
    cand.push({ email: account.found_email, name: "", role: "", confidence: many ? "probable" : "supposé",
      source: account.found_email_source || "recherche web" });
  }
  for (const l of w.leaders_emails || []) {
    if (!/trouvé|observé/.test(l.confidence || "")) cand.push({ email: l.email, name: prettyName(l.name), role: l.role || "", confidence: "supposé", source: "motif courant, à vérifier" });
  }
  // Dernier recours : le domaine reçoit des emails (MX) → contact@ supposé.
  const domain = account.domain || (w.site?.url ? String(w.site.url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "");
  if (domain && w.dns?.has_mx) cand.push({ email: `contact@${domain}`, name: "", role: "", confidence: "supposé", source: "adresse courante, à vérifier", generic: true });
  const rank = { "sûr": 0, probable: 1, "supposé": 2 };
  const valid = cand.filter((c) => EMAIL_OK.test(c.email || ""));
  // Meilleure confiance d'abord ; à confiance égale : informatique, puis nominatif, puis générique.
  valid.sort((a, b) => (Number(!!b.manual) - Number(!!a.manual)) || (rank[a.confidence] - rank[b.confidence]) || (Number(!!b.it) - Number(!!a.it))
    || (Number(!!a.generic) - Number(!!b.generic)));
  if (!valid[0]) return null;
  const { manual, it, generic, ...best } = valid[0];
  return { ...best, email: best.email.toLowerCase(), generic: !!generic };
}
