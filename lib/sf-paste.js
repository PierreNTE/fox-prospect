// Fiche Salesforce collée sur la fiche du lead — analysée dans le navigateur.
// Seules les données de la SOCIÉTÉ (code postal, commune, rue, emails
// génériques, domaines d'email) et des codes d'anomalie partent au serveur.
// Les noms, emails et téléphones nominatifs restent dans le navigateur :
// jamais stockés, jamais envoyés. Fonction pure, testée.
import { deptOf, phoneMatchesDept } from "@/lib/call-brief";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<![\d+])(?:\+33[\s.-]?(?:\(0\)[\s.-]?)?|0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)/g;
const GENERIC = /^(contact|info|infos|accueil|direction|secretariat|secr[ée]tariat|admin|administration|dsi|informatique|it|support|compta|comptabilite|rh|commercial|ventes|bonjour|hello|mairie|standard|office)\b/i;
const STREET = /\b\d{1,4}\s*(?:bis|ter)?,?\s+(?:rue|avenue|av\.?|boulevard|bd|chemin|allée|allee|place|route|impasse|quai|cours|square|rond-point|zone|za|zi|zac|parc|lieu[- ]dit|voie|passage|esplanade)\b[^\n\t;,]*/i;
const NOTE_WORDS = /note|description|commentaire|remarque|besoin|appel|t[âa]che|activit|compte[- ]rendu|r[ée]sum[ée]|e-?mail envoy|rdv|rendez/i;

function parseDate(s) {
  let m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}

/**
 * @param {string} text  fiche Salesforce copiée (Lightning, vue imprimable…)
 * @param {{ siegeCp?: string, now?: Date }} opts  code postal du siège SIRENE (contrôle des indicatifs)
 * @returns {{ code_postal, commune, rue, generic_emails, domains, flags, counts }}
 */
export function parseSalesforcePaste(text, { siegeCp = "", now = new Date() } = {}) {
  const t = String(text || "");
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Adresse : champs étiquetés d'abord, sinon la première ligne « 12345 Commune ».
  let code_postal = ""; let commune = ""; let rue = "";
  const labelled = (re) => {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (m) return (m[1] || lines[i + 1] || "").trim();
    }
    return "";
  };
  code_postal = (labelled(/^(?:code postal|zip(?:\/postal)? code|postal code)\s*[:\t]?\s*(\d{5})?\s*$/i).match(/\d{5}/) || [""])[0];
  commune = labelled(/^(?:ville|city|commune)\s*[:\t]?\s*(.*)$/i);
  rue = labelled(/^(?:rue|street|adresse|address)\s*[:\t]?\s*(.*)$/i);
  if (!code_postal) {
    const m = t.match(/\b(\d{5})\s+([A-ZÀ-Ÿa-zà-ÿ][A-Za-zÀ-ÿ' -]{1,40})/);
    if (m) { code_postal = m[1]; if (!commune) commune = m[2].replace(/\s+(France|FR)$/i, "").trim(); }
  }
  if (!rue || !STREET.test(rue)) rue = (t.match(STREET) || [""])[0].trim();
  rue = rue.replace(/\s+\d{5}.*$/, "").slice(0, 120);
  commune = commune.replace(/\s+\d{5}.*$/, "").replace(/\s+(France|FR)$/i, "").slice(0, 60);

  // Emails : seuls les génériques (contact@, info@…) sont gardés ; des nominatifs,
  // on ne garde que le domaine (contrôle d'une faute de frappe ou d'un domaine mort).
  const emails = [...new Set((t.match(EMAIL_RE) || []).map((e) => e.toLowerCase().replace(/\.$/, "")))];
  const generic_emails = emails.filter((e) => GENERIC.test(e.split("@")[0]));
  const domains = [...new Set(emails.map((e) => e.split("@")[1]))].filter((d) => !/dell\.com$/i.test(d)).slice(0, 8);

  const flags = [];
  // Note périmée : la date la plus récente d'une ligne de note / d'activité.
  let last = null;
  for (let i = 0; i < lines.length; i++) {
    if (!NOTE_WORDS.test(lines[i]) && !NOTE_WORDS.test(lines[i - 1] || "")) continue;
    const dt = parseDate(lines[i]);
    if (dt && (!last || dt > last)) last = dt;
  }
  if (last && (now - last) / (1000 * 60 * 60 * 24 * 30.44) > 24) {
    flags.push({ code: "NOTE_STALE", detail: `dernière note du ${last.toLocaleDateString("fr-FR", { timeZone: "UTC" })}` });
  }

  // Indicatifs : un fixe d'une autre région que le siège ou l'adresse Salesforce.
  const depts = [deptOf(siegeCp), deptOf(code_postal)].filter(Boolean);
  const phones = [...new Set((t.match(PHONE_RE) || []))];
  const off = phones.filter((p) => depts.length && depts.every((dp) => phoneMatchesDept(p, dp) === false));
  if (off.length) {
    flags.push({ code: "PHONE_AREA_MISMATCH", detail: `${off.length} numéro(s) en ${off.map((p) => p.replace(/\D/g, "").replace(/^33/, "0").slice(0, 2)).join(", ")} pour le ${depts.join(" / ")}` });
  }

  return { code_postal, commune, rue, generic_emails, domains, flags, counts: { emails: emails.length, phones: phones.length } };
}
