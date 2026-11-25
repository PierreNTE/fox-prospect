// Qualité d'une adresse email trouvée pour une société — mêmes règles que
// scripts/contact-sources/email_quality.py (worker). Pur, testé dans
// tests/email-quality.test.js.
//
// Écarte : boîtes inadaptées (recrutement, RGPD, webmaster, noreply, presse,
// compta…), filiales étrangères, adresses personnelles quand la société a son
// domaine, adresses d'une autre organisation que le site officiel.

export const WEBMAIL = new Set([
  "gmail.com", "googlemail.com", "hotmail.fr", "hotmail.com", "live.fr", "live.com", "outlook.fr", "outlook.com",
  "msn.com", "yahoo.fr", "yahoo.com", "icloud.com", "me.com", "aol.com", "aol.fr", "gmx.fr", "gmx.com", "orange.fr",
  "wanadoo.fr", "free.fr", "sfr.fr", "neuf.fr", "laposte.net", "bbox.fr", "aliceadsl.fr", "club-internet.fr", "numericable.fr",
  "protonmail.com", "proton.me",
]);
const REJECT_LOCAL = new RegExp("^(no-?reply|noreply|ne-?pas-?repondre|donotreply|do-not-reply|recrutement|recruitment|recrute|recruit|jobs?|emplois?|"
  + "careers?|carrieres?|candidatures?|candidats?|stages?|alternance|rh|drh|hr|rgpd|dpo|privacy|gdpr|cnil|donnees-?personnelles|"
  + "webmaster|website|web|postmaster|hostmaster|abuse|newsletters?|unsubscribe|desinscription|presse|press|media|medias|"
  + "facturation|factures?|invoices?|billing|compta|comptabilite|accounting|fournisseurs?|suppliers?)$");
const WEAK_LOCAL = /^(commercial|commerciale|sales|ventes?|sav|service-?client|serviceclient|customer-?service|commandes?|orders?|shop|boutique|marketing|communication|reservations?|booking)$/;
const GENERIC_LOCAL = /^(contact|contacts|info|infos|information|accueil|bonjour|hello|hi|mail|email|office|secretariat|direction|admin|administration|standard|reception|siege|agence|general)\b/;
const FOREIGN_WORDS = new Set(["germany", "deutschland", "gmbh", "espana", "spain", "italia", "italy", "uk", "usa", "nederland", "netherlands",
  "polska", "poland", "portugal", "benelux", "belgium", "schweiz", "austria", "india", "china", "japan"]);
const FOREIGN_TLD = [".de", ".it", ".es", ".co.uk", ".uk", ".nl", ".pl", ".pt", ".at", ".cn", ".in", ".jp"];
const STOP = new Set(["sa", "sas", "sasu", "sarl", "eurl", "sci", "snc", "scop", "sem", "gie", "se", "selarl", "selas", "ste", "societe",
  "et", "de", "du", "des", "la", "le", "les", "l", "d", "and", "the", "groupe", "group", "france", "cie", "compagnie",
  "cabinet", "ets", "etablissements", "holding", "international", "industrie", "industries", "services", "solutions",
  "conseil", "consulting", "en", "sur", "a", "au", "aux"]);
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();

export const coreTokens = (name) => norm(String(name || "").replace(/\(.*?\)/g, " ")).split(" ").filter((t) => t && !STOP.has(t));

/** « www.alpha-motors.co.uk » → « alphamotors ». */
export function domainBase(host) {
  const parts = String(host || "").toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length < 2) return parts.join("").replace(/-/g, "");
  const label = parts.length >= 3 && ["co", "com", "gouv", "asso"].includes(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2];
  return label.replace(/-/g, "");
}

export const hostOf = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].toLowerCase();

/** « strong » : le domaine est le nom (ou ses initiales) ; « weak » : il le contient ; sinon null. */
/** Noms + sigles entre parenthèses : « MONTS INSERTION (MIF CONSEIL) » → [nom, « MIF CONSEIL »]. */
export const expandNames = (names) => [...new Set((names || []).flatMap((n) =>
  [n, ...[...String(n || "").matchAll(/\(([^)]+)\)/g)].map((m) => m[1])]).filter(Boolean))];

export function nameMatch(base, names) {
  let best = null;
  for (const name of expandNames(names)) {
    const core = coreTokens(name);
    if (!core.length) continue;
    const compact = core.join("");
    const full = norm(name).replace(/ /g, "");
    const initials = core.map((t) => (t.length <= 3 ? t : t[0])).join("");
    const stripped = base.replace(/\d+$/, "");
    if (base === compact || base === full || (stripped && stripped === compact) || (core.length >= 3 && base === initials)) return "strong";
    if (compact.length >= 4 && base.startsWith(compact) && /^(fr|france|groupe|group|sa|sas)?$/.test(base.slice(compact.length))) return "strong";
    if (core.some((t) => t.length >= 4 && base.includes(t)) || (compact.length >= 5 && base.includes(compact))) best = "weak";
  }
  return best;
}

/**
 * @returns {{ ok: boolean, level?: "strong"|"weak", reason: string, generic?: boolean, weak_box?: boolean }}
 */
export function assessEmail(email, { names = [], domains = [], official = false } = {}) {
  const e = String(email || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!EMAIL_OK.test(e)) return { ok: false, reason: "adresse mal formée" };
  const [local, dom] = e.split("@");
  const extra = { generic: GENERIC_LOCAL.test(local), weak_box: WEAK_LOCAL.test(local) };
  if (REJECT_LOCAL.test(local)) return { ok: false, reason: "boîte non adaptée (recrutement, RGPD, webmaster…)" };
  const words = new Set([...local.split(/[._\-+]/), ...dom.split(/[.-]/)]);
  if ([...words].some((w) => FOREIGN_WORDS.has(w)) || FOREIGN_TLD.some((t) => dom.endsWith(t))) {
    return { ok: false, reason: "filiale ou bureau étranger" };
  }
  if (official) return { ok: true, level: "strong", reason: "source officielle", ...extra };
  const own = (domains || []).filter(Boolean);
  if (WEBMAIL.has(dom)) {
    if (own.length) return { ok: false, reason: "adresse personnelle alors que la société a son propre domaine" };
    const compactLocal = norm(local).replace(/ /g, "");
    if ((names || []).some((n) => coreTokens(n).some((t) => t.length >= 3 && compactLocal.includes(t)))) {
      return { ok: true, level: "weak", reason: "messagerie grand public au nom de la société", ...extra };
    }
    return { ok: false, reason: "adresse personnelle sans le nom de la société" };
  }
  const b = domainBase(dom);
  if (own.some((d) => domainBase(d) === b)) return { ok: true, level: "strong", reason: "domaine du site officiel", ...extra };
  const m = nameMatch(b, names);
  if (own.length) {
    return m === "strong"
      ? { ok: true, level: "weak", reason: "domaine au nom de la société, différent du site connu", ...extra }
      : { ok: false, reason: "domaine d'une autre organisation que le site officiel" };
  }
  if (m) return { ok: true, level: m, reason: "domaine au nom de la société", ...extra };
  return { ok: false, reason: "domaine sans rapport avec la société" };
}

/** Contexte d'un compte pour assessEmail : noms (Salesforce, SIRENE) et domaines connus (site). */
export function emailContext(account = {}) {
  const d = account.health_detail || {};
  const w = account.web_intel || {};
  const domains = [...new Set([account.domain, hostOf(account.website), hostOf(w.site?.url)].map(hostOf).filter(Boolean))];
  return { names: [account.name, d.sirene_name].filter(Boolean), domains };
}

/**
 * Rejet net, valable pour toute source (site officiel, contacts, recherche) :
 * boîte inadaptée, filiale étrangère, messagerie perso alors que la société a
 * son domaine. Les contrôles de domaine ne s'appliquent qu'à la recherche web.
 */
export function hardReject(email, ctx = {}) {
  const q = assessEmail(email, { names: ctx.names || [], domains: ctx.domains || [] });
  return !q.ok && /boîte non adaptée|étranger|personnelle alors|mal formée/.test(q.reason);
}
