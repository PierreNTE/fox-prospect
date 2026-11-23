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
