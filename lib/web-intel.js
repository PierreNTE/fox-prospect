// Collecte web gratuite (sans IA) : site officiel, coordonnées publiques,
// réseaux, outils repérés. Tout est déduit des pages publiques de la société
// (accueil, contact, mentions légales, à propos, recrutement), en respectant
// robots.txt, avec quelques requêtes par compte et des délais courts.
//
// Fonctions pures (extraction) testées ; le réseau passe par `http`, injectable.
import { normalizeName, tokens, nameScore } from "@/lib/company-health";

const UA = "Mozilla/5.0 (compatible; FoxProspect/1.0; collecte de coordonnées publiques B2B)";
const MAX_BYTES = 1_500_000;

// Annuaires et réseaux : jamais retenus comme « site officiel ».
export const DIRECTORY_HOSTS = /(^|\.)(societe\.com|pappers\.fr|verif\.com|infogreffe\.fr|annuaire-entreprises\.data\.gouv\.fr|data\.gouv\.fr|pagesjaunes\.fr|linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|wikipedia\.org|manageo\.fr|corporama\.com|societeinfo\.com|lefigaro\.fr|kompass\.com|bodacc\.fr|entreprises\.lefigaro\.fr|indeed\.com|welcometothejungle\.com|google\.[a-z.]+|mappy\.com|118712\.fr|annuaire\.[a-z]+)$/i;

// ── Réseau ────────────────────────────────────────────────────────────────

export const http = {
  async get(url, { timeout = 7000 } = {}) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "fr-FR,fr;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
    const type = res.headers.get("content-type") || "";
    let text = "";
    if (res.ok && /text|html|xml|json/i.test(type || "text/html")) {
      const buf = await res.arrayBuffer();
      text = new TextDecoder("utf-8").decode(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf);
    }
    return { ok: res.ok, status: res.status, url: res.url || url, text };
  },
};

// ── Extraction (pur) ─────────────────────────────────────────────────────

const decode = (s) => s
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#64;|&commat;/g, "@")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Texte visible approximatif d'une page HTML. */
export function htmlToText(html) {
  return decode(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|td|section|footer|header)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return ""; }
}

/** Domaine « racine » approximatif (exemple.fr pour www.shop.exemple.fr). */
export function rootDomain(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const sld = parts.slice(-2).join(".");
  return /^(co|com|gouv|asso|org)\.[a-z]{2}$/.test(sld) ? parts.slice(-3).join(".") : sld;
}

const IGNORED_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|^(example|exemple|test|email|votre|your|nom|name|prenom|user)@|@(example|exemple|domain|domaine|sentry|wixpress|sentry-next)\.|@[0-9.]+$|\.wixpress\.com$/i;

/** Emails publics d'une page (liens mailto, texte, formes « [at] »). */
export function extractEmails(html) {
  const raw = decode(String(html || ""));
  const text = raw
    .replace(/\s*[[(]\s*(at|arobase)\s*[\])]\s*/gi, "@")
    .replace(/\s+(arobase)\s+/gi, "@")
    .replace(/\s*[[(]\s*(dot|point)\s*[\])]\s*/gi, ".");
  const out = new Set();
  for (const m of text.matchAll(/mailto:([^"'?>\s]+)/gi)) out.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) out.add(m[0].toLowerCase());
  return [...out].map((e) => e.replace(/[.,;:]+$/, "")).filter((e) => !IGNORED_EMAIL.test(e) && e.length <= 80);
}

/** Format affichable d'un numéro français. */
export function formatPhone(raw) {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+33")) d = `0${d.slice(3).replace(/^0/, "")}`; // « +33 (0)2… »
  else if (d.startsWith("0033")) d = `0${d.slice(4).replace(/^0/, "")}`;
  if (!/^0[1-9]\d{8}$/.test(d)) return null;
  return d.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

/** Téléphones français d'une page : liens tel: d'abord, puis texte. Classés par fréquence. */
export function extractPhones(html) {
  const counts = new Map();
  const bump = (p, w) => { if (p) counts.set(p, (counts.get(p) || 0) + w); };
  const src = decode(String(html || ""));
  for (const m of src.matchAll(/href=["']tel:([^"']+)["']/gi)) bump(formatPhone(m[1]), 3);
  const text = htmlToText(src);
  for (const m of text.matchAll(/(?<![\d])(?:\+33\s?\(?0?\)?\s?|0033\s?|0)[1-9](?:[\s.-]?\d{2}){4}(?![\d])/g)) {
    const before = text.slice(Math.max(0, m.index - 25), m.index);
    if (/(siret|siren|rcs|tva|capital)[^0-9a-z]{0,6}$/i.test(before)) continue;
    bump(formatPhone(m[0]), 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

export function phoneKind(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (/^0[67]/.test(d)) return "mobile";
  if (/^08/.test(d)) return "special";
  if (/^09/.test(d)) return "voip";
  return "fixe";
}

const SOCIALS = [
  { key: "linkedin", re: /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|school|showcase)\/[A-Za-z0-9\-_.%]+/gi },
  { key: "facebook", re: /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b)[A-Za-z0-9.\-_%]+/gi },
  { key: "x", re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home)[A-Za-z0-9_]{2,}/gi },
  { key: "youtube", re: /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|user\/|@)[A-Za-z0-9\-_%]+/gi },
  { key: "instagram", re: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/)[A-Za-z0-9._]{2,}/gi },
];

export function extractSocials(html) {
  const out = {};
  for (const s of SOCIALS) {
    const m = String(html || "").match(s.re);
    if (m?.length) out[s.key] = m[0].replace(/\/+$/, "");
  }
  return out;
}

const PAGE_HINTS = [
  { key: "contact", re: /contact|nous-joindre|nous-contacter|coordonn/i },
  { key: "mentions", re: /mentions[-_ ]?l[ée]gales|legal|imprint|cgu|informations[-_ ]l[ée]gales/i },
  { key: "about", re: /a-propos|qui-sommes|about|notre-histoire|l-entreprise|presentation|equipe|team|notre-equipe/i },
  { key: "careers", re: /recrut|carri[eè]re|emploi|jobs?\b|nous-rejoindre|join-us|careers/i },
];

/** Liens internes intéressants (contact, mentions légales, à propos, recrutement). */
export function pickInternalLinks(html, baseUrl) {
  const base = hostOf(baseUrl);
  const found = {};
  for (const m of String(html || "").matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try { url = new URL(m[1], baseUrl); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || rootDomain(url.hostname) !== rootDomain(base)) continue;
    if (/\.(pdf|jpe?g|png|zip|docx?)$/i.test(url.pathname)) continue;
    const label = `${url.pathname} ${htmlToText(m[2])}`;
    for (const h of PAGE_HINTS) {
      if (!found[h.key] && h.re.test(label)) found[h.key] = url.href.split("#")[0];
    }
  }
  return found;
}

/** SIREN (9 chiffres, espacés ou non) présent dans un texte ? */
export function textHasSiren(text, siren) {
  if (!siren) return false;
  const re = new RegExp(siren.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1[\\s.\\u00a0]?$2[\\s.\\u00a0]?$3"));
  return re.test(String(text || ""));
}

export function pageTitle(html) {
  const og = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i.exec(html || "");
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
  return decode((og?.[1] || t?.[1] || "").replace(/\s+/g, " ").trim()).slice(0, 160);
}

// Outils et briques d'infra cités sur le site (offres d'emploi, références, mentions).
export const TECH_TERMS = [
  { label: "VMware", cat: "Virtualisation", re: /\bvmware\b|\bvsphere\b|\besxi\b|\bvsan\b/i },
  { label: "Hyper-V", cat: "Virtualisation", re: /\bhyper-?v\b/i },
  { label: "Nutanix", cat: "Virtualisation", re: /\bnutanix\b/i },
  { label: "Proxmox", cat: "Virtualisation", re: /\bproxmox\b/i },
  { label: "Citrix", cat: "Virtualisation", re: /\bcitrix\b/i },
  { label: "Veeam", cat: "Sauvegarde", re: /\bveeam\b/i },
  { label: "Commvault", cat: "Sauvegarde", re: /\bcommvault\b/i },
  { label: "Rubrik", cat: "Sauvegarde", re: /\brubrik\b/i },
  { label: "Acronis", cat: "Sauvegarde", re: /\bacronis\b/i },
  { label: "Veritas", cat: "Sauvegarde", re: /\bveritas\b|\bnetbackup\b|\bbackup ?exec\b/i },
  { label: "NetApp", cat: "Stockage", re: /\bnetapp\b/i },
  { label: "Pure Storage", cat: "Stockage", re: /\bpure ?storage\b/i },
  { label: "Synology", cat: "Stockage", re: /\bsynology\b/i },
  { label: "QNAP", cat: "Stockage", re: /\bqnap\b/i },
  { label: "HPE", cat: "Serveurs / stockage", re: /\bhpe\b|\bhewlett[- ]packard enterprise\b|\bproliant\b|\b3par\b|\bnimble\b|\balletra\b/i },
  { label: "Dell", cat: "Serveurs / stockage", re: /\bdell\b|\bpoweredge\b|\bpowerstore\b|\bemc\b|\bvxrail\b/i },
  { label: "Lenovo", cat: "Serveurs / stockage", re: /\blenovo\b|\bthinksystem\b/i },
  { label: "Cisco", cat: "Réseau", re: /\bcisco\b|\bmeraki\b/i },
  { label: "Fortinet", cat: "Sécurité", re: /\bfortinet\b|\bfortigate\b/i },
  { label: "Stormshield", cat: "Sécurité", re: /\bstormshield\b/i },
  { label: "Microsoft Azure", cat: "Cloud", re: /\bazure\b/i },
  { label: "AWS", cat: "Cloud", re: /\baws\b|amazon web services/i },
  { label: "OVHcloud", cat: "Cloud", re: /\bovh(cloud)?\b/i },
  { label: "Google Cloud", cat: "Cloud", re: /google cloud|\bgcp\b/i },
  { label: "Scaleway", cat: "Cloud", re: /\bscaleway\b/i },
  { label: "Microsoft 365", cat: "Bureautique", re: /office ?365|microsoft ?365|\bm365\b/i },
  { label: "SAP", cat: "ERP", re: /\bsap\b(?! ?hana ?cloud)|\bs\/4 ?hana\b/ },
  { label: "Sage", cat: "ERP", re: /\bsage (100|x3|1000|paie)\b/i },
  { label: "Cegid", cat: "ERP", re: /\bcegid\b/i },
  { label: "Microsoft Dynamics", cat: "ERP", re: /\bdynamics ?(365|nav|ax)\b/i },
  { label: "Active Directory", cat: "Annuaire", re: /active directory|\bentra id\b|\bazure ad\b/i },
  { label: "Linux", cat: "Systèmes", re: /\blinux\b|\bred ?hat\b|\bdebian\b|\bubuntu\b/i },
];

export function detectTech(text) {
  const t = String(text || "");
  return TECH_TERMS.filter((x) => x.re.test(t)).map(({ label, cat }) => ({ label, cat }));
}

const HOSTERS = ["OVH", "o2switch", "Ionos", "1&1", "Gandi", "Scaleway", "Online SAS", "Infomaniak", "Hostinger", "Amazon Web Services", "AWS", "Microsoft", "Google", "Wix", "Shopify", "Squarespace", "Webflow", "LWS", "PlanetHoster", "Hostpapa", "Cloudflare", "Netlify", "Vercel", "Kinsta", "WP Engine", "Jimdo", "Orange", "SFR", "Free", "Alwaysdata", "Ikoula", "Claranet", "Oxeva", "Nuxit"];

/** Hébergeur cité dans les mentions légales. */
export function extractHoster(text) {
  const m = /h[ée]berg(?:eur|ement|é par|e par|ée par)[^\n]{0,160}/i.exec(String(text || ""));
  if (!m) return null;
  const hit = HOSTERS.find((h) => new RegExp(`\\b${h.replace(/[.&]/g, "\\$&")}\\b`, "i").test(m[0]));
  return hit || null;
}

const GENERIC_LOCAL = /^(contact|info|infos|information|accueil|bonjour|hello|commercial|commerciale|ventes?|sales|compta|comptabilite|facturation|factures?|rh|recrutement|jobs?|emploi|candidature|admin|administration|mairie|secretariat|direction|service|services|support|sav|technique|tech|it|informatique|dsi|webmaster|communication|marketing|presse|press|office|reception|devis|achats?|noreply|no-reply|newsletter|dpo|rgpd|privacy|legal|juridique|qualite)$/i;

export function isGenericEmail(email) {
  return GENERIC_LOCAL.test(String(email || "").split("@")[0]);
}

const nameParts = (full) => {
  const parts = normalizeName(full).toLowerCase().split(" ").filter(Boolean);
  return { first: parts[0] || "", last: parts.slice(1).join("") || "" };
};

/** Motif d'email déduit d'adresses nominatives trouvées et de noms connus. */
export function inferEmailPattern(emails, people = []) {
  const named = emails.filter((e) => !isGenericEmail(e));
  for (const p of people) {
    const { first, last } = nameParts(p.name);
    if (!first || !last) continue;
    for (const e of named) {
      const local = e.split("@")[0];
      if (local === `${first}.${last}`) return "prenom.nom";
      if (local === `${first[0]}.${last}`) return "p.nom";
      if (local === `${first[0]}${last}`) return "pnom";
      if (local === `${first}${last}`) return "prenomnom";
      if (local === `${last}.${first}`) return "nom.prenom";
      if (local === last) return "nom";
      if (local === first) return "prenom";
    }
  }
  if (named.some((e) => /^[a-z]+\.[a-z-]+@/.test(e) && !/^[a-z]\./.test(e))) return "prenom.nom";
  if (named.some((e) => /^[a-z]\.[a-z-]+@/.test(e))) return "p.nom";
  return null;
}

export function applyPattern(pattern, fullName, domain) {
  const { first, last } = nameParts(fullName);
  if (!first || !last || !domain) return null;
  const local = {
    "prenom.nom": `${first}.${last}`, "p.nom": `${first[0]}.${last}`, pnom: `${first[0]}${last}`,
    prenomnom: `${first}${last}`, "nom.prenom": `${last}.${first}`, nom: last, prenom: first,
  }[pattern];
  return local ? `${local}@${domain}` : null;
}

/** Règles robots.txt (User-agent: *) — renvoie une fonction allowed(path). */
export function parseRobots(txt) {
  const lines = String(txt || "").split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
  const rules = [];
  let applies = false;
  let lastWasAgent = false;
  for (const l of lines) {
    const m = /^(user-agent|disallow|allow)\s*:\s*(.*)$/i.exec(l);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") {
      if (!lastWasAgent) applies = false;
      if (m[2] === "*") applies = true;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (applies && m[2]) rules.push({ allow: key === "allow", path: m[2] });
  }
  return (path) => {
    let best = null;
    for (const r of rules) {
      const re = new RegExp(`^${r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}`);
      if (re.test(path) && (!best || r.path.length > best.path.length)) best = r;
    }
    return !best || best.allow;
  };
}

/** Candidats de domaine à partir du nom (sans formes juridiques). */
export function domainCandidates(name) {
  const t = tokens(name).map((x) => x.toLowerCase()).filter((x) => /^[a-z0-9]+$/.test(x));
  if (!t.length) return [];
  const bases = new Set([t.join(""), t.join("-")]);
  if (t.length >= 3) { bases.add(t.slice(0, 2).join("")); bases.add(t.slice(0, 2).join("-")); }
  if (t.length >= 2 && t[0].length >= 4) bases.add(t[0]);
  const out = [];
  for (const b of bases) if (b.length >= 3 && b.length <= 40) out.push(`${b}.fr`, `${b}.com`);
  return out.slice(0, 8);
}

/** Le site correspond-il à la société ? « verifie » (SIREN trouvé), « probable » (nom), sinon null. */
export function siteMatch({ html, text, siren, name }) {
  if (textHasSiren(text, siren)) return "verifie";
  const title = pageTitle(html);
  if (title && nameScore(name, title) >= 0.75) return "probable";
  return null;
}

/**
 * Explore un site : accueil + jusqu'à 4 pages utiles. Renvoie les éléments bruts.
 * @param {string} url
 * @param {{ siren?: string, name?: string, http?: typeof http }} ctx
 */
export async function crawlSite(url, { siren, name, http: h = http } = {}) {
  const home = await h.get(url);
  if (!home.ok || !home.text) return null;
  const finalUrl = (home.url || url).replace(/([^:])\/{2,}/g, "$1/");
  const origin = new URL(finalUrl).origin;

  let allowed = () => true;
  try {
    const r = await h.get(`${origin}/robots.txt`, { timeout: 4000 });
    if (r.ok && r.text && !/<html/i.test(r.text)) allowed = parseRobots(r.text);
  } catch { /* pas de robots.txt : tout est permis */ }

  const links = pickInternalLinks(home.text, finalUrl);
  // Mentions légales souvent non liées depuis l'accueil : chemins usuels en repli.
  if (!links.mentions) links.mentions = `${origin}/mentions-legales`;
  if (!links.contact) links.contact = `${origin}/contact`;

  const pages = [{ key: "home", url: finalUrl, html: home.text }];
  const targets = ["mentions", "contact", "about", "careers"].filter((k) => links[k]);
  const fetched = await Promise.all(targets.map(async (k) => {
    const u = links[k];
    if (!allowed(new URL(u).pathname)) return null;
    try {
      const r = await h.get(u, { timeout: 6000 });
      return r.ok && r.text ? { key: k, url: r.url || u, html: r.text } : null;
    } catch { return null; }
  }));
  pages.push(...fetched.filter(Boolean));

  const allHtml = pages.map((p) => p.html).join("\n");
  const allText = pages.map((p) => htmlToText(p.html)).join("\n");
  const mentionsText = htmlToText(pages.find((p) => p.key === "mentions")?.html || "");
  return {
    url: finalUrl,
    host: hostOf(finalUrl),
    title: pageTitle(home.text),
    match: siteMatch({ html: home.text, text: allText, siren, name }),
    pages: pages.map((p) => ({ key: p.key, url: p.url })),
    emails: extractEmails(allHtml),
    phones: extractPhones(allHtml),
    socials: extractSocials(allHtml),
    tech: detectTech(allText),
    hoster: extractHoster(mentionsText || allText),
    careers_url: pages.find((p) => p.key === "careers")?.url || null,
  };
}
