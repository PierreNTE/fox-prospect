// Collecte gratuite d'informations publiques pour un compte (sans IA) :
//   1. site officiel (site connu, Wikidata par SIREN, Brave Search si clé,
//      sinon domaines devinés) — vérifié par le SIREN des mentions légales ;
//   2. coordonnées du site : standard, emails, LinkedIn société, réseaux ;
//   3. outils repérés : site (offres d'emploi…) + DNS (Microsoft 365, Google…) ;
//   4. emails probables des dirigeants légaux (motif observé ou courant) ;
//   5. acheteur public : marchés informatiques au BODACC des marchés (BOAMP).
// Résultat dans accounts.web_intel (+ website / domain si vides).
import {
  crawlSite, domainCandidates, hostOf, rootDomain, DIRECTORY_HOSTS, inferEmailPattern, applyPattern,
  isGenericEmail, phoneKind, formatPhone, http as defaultHttp,
} from "@/lib/web-intel";
import { dnsIntel, domainResolves } from "@/lib/dns-intel";
import { tokens } from "@/lib/company-health";
import { fetchItNotices, isPublicBuyer } from "@/lib/boamp";
import { fetchCompanyNews } from "@/lib/news-rss";
import { aiEnabled } from "@/lib/constants";
import { saveFreeCallPrep } from "@/lib/call-prep";
import { nameScore } from "@/lib/company-health";

const WIKIDATA = "https://query.wikidata.org/sparql";

export async function wikidataWebsite(siren) {
  if (!/^\d{9}$/.test(siren || "")) return null;
  const query = `SELECT ?site WHERE { ?i wdt:P1616 "${siren}" ; wdt:P856 ?site } LIMIT 2`;
  const res = await fetch(`${WIKIDATA}?${new URLSearchParams({ query, format: "json" })}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": "FoxProspect/1.0 (prospection B2B)" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.results?.bindings?.[0]?.site?.value || null;
}

// OpenStreetMap (Nominatim) : gratuit, sans clé. Beaucoup de commerces,
// cabinets et collectivités y ont leur site et leur téléphone. Politique
// d'usage : 1 requête / s maximum, application identifiée — notre volume
// (un appel par compte) reste très en dessous.
export async function osmLookup(name, commune) {
  if (!name) return null;
  const q = [name, commune].filter(Boolean).join(", ");
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q, format: "jsonv2", extratags: "1", limit: "5", countrycodes: "fr",
  })}`, {
    headers: { "User-Agent": "FoxProspect/1.0 (prospection B2B ; https://fox-prospect.vercel.app)", Accept: "application/json", "Accept-Language": "fr" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  return pickOsm(await res.json(), name);
}

/** Meilleur résultat OSM au nom concordant (pur, testé). */
export function pickOsm(results, name) {
  const best = (results || [])
    .map((r) => ({ r, score: nameScore(name, r.name || r.display_name?.split(",")[0] || "") }))
    .filter((x) => x.score >= 0.8)
    .sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  const t = best.r.extratags || {};
  return {
    website: t.website || t["contact:website"] || t.url || null,
    phone: t.phone || t["contact:phone"] || null,
    email: t.email || t["contact:email"] || null,
    osm: `https://www.openstreetmap.org/${best.r.osm_type}/${best.r.osm_id}`,
  };
}

async function braveWebsites(name, commune) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  const q = `${name} ${commune || ""}`.trim();
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, country: "fr", count: "8" })}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.web?.results || []).map((r) => r.url).filter((u) => !DIRECTORY_HOSTS.test(hostOf(u))).slice(0, 4);
}

const normalizeUrl = (u) => {
  if (!u) return null;
  const s = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try { const x = new URL(s); return `${x.protocol}//${x.hostname}/`; } catch { return null; }
};

/**
 * Site trouvé par recherche ou deviné : SIREN présent sur le site, ou nom
 * distinctif (≥ 5 caractères) à la fois dans le domaine et dans le titre.
 * Évite « 123 » → 123.fr ou « Mission locale » → missionlocale.fr.
 */
export function acceptGuess(site, name) {
  if (site.match === "verifie") return true;
  if (site.match !== "probable") return false;
  const core = tokens(name).join("").toLowerCase();
  const label = String(site.host || "").replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/g, "");
  return core.length >= 5 && label === core;
}

/** Trouve et explore le site officiel. Renvoie { site, tried }. */
export async function findOfficialSite({ name, siren, commune, website }, { http = defaultHttp } = {}) {
  const tried = [];
  const seen = new Set();
  const tryUrl = async (u, origin) => {
    const url = normalizeUrl(u);
    if (!url || seen.has(hostOf(url)) || DIRECTORY_HOSTS.test(hostOf(url))) return null;
    seen.add(hostOf(url));
    tried.push(`${hostOf(url)} (${origin})`);
    const site = await crawlSite(url, { siren, name, http }).catch(() => null);
    // Site déjà connu ou déclaré officiel sur Wikidata : accepté même sans preuve sur la page.
    return site && (site.match || origin === "site connu" || origin === "Wikidata") ? { ...site, origin } : null;
  };

  if (website) {
    const s = await tryUrl(website, "site connu");
    if (s) return { site: s, tried };
  }
  const wd = await wikidataWebsite(siren).catch(() => null);
  if (wd) {
    const s = await tryUrl(wd, "Wikidata");
    if (s) return { site: s, tried };
  }
  const osm = await osmLookup(name, commune).catch(() => null);
  if (osm?.website) {
    const s = await tryUrl(osm.website, "OpenStreetMap");
    if (s && (s.match || osm.phone)) return { site: s, tried, osm };
  }
  for (const u of await braveWebsites(name, commune).catch(() => [])) {
    const s = await tryUrl(u, "recherche web");
    if (s && acceptGuess(s, name)) return { site: s, tried };
  }
  // Domaines devinés : on ne visite que ceux qui existent dans le DNS.
  const cands = domainCandidates(name);
  const alive = (await Promise.all(cands.map(async (d) => ((await domainResolves(d)) ? d : null)))).filter(Boolean);
  for (const d of alive.slice(0, 4)) {
    const s = await tryUrl(d, "domaine deviné");
    if (s && acceptGuess(s, name)) return { site: s, tried };
  }
  return { site: null, tried, osm };
}

/** Emails probables des dirigeants à partir du motif du domaine. */
export function guessLeaderEmails(dirigeants, emails, domain, hasMx) {
  if (!domain || !hasMx) return [];
  const sameDomain = emails.filter((e) => rootDomain(e.split("@")[1]) === rootDomain(domain));
  const observed = inferEmailPattern(sameDomain, dirigeants);
  const pattern = observed || "prenom.nom";
  return (dirigeants || []).slice(0, 4).map((d) => {
    const exact = sameDomain.find((e) => {
      const local = e.split("@")[0];
      const last = d.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(" ").pop();
      return last && last.length >= 3 && local.includes(last);
    });
    const email = exact || applyPattern(pattern, d.name, rootDomain(domain));
    return email && {
      name: d.name, role: d.role, email,
      confidence: exact ? "trouvé sur le site" : observed ? "motif observé" : "motif courant, à vérifier",
    };
  }).filter(Boolean);
}

/**
 * Collecte complète pour un compte.
 * @param {object} account  ligne accounts (name, website, domain, health_detail)
 */
export async function collectAccountIntel(account, { http } = {}) {
  const d = account.health_detail || {};
  const name = d.sirene_name || account.name;
  const startedAt = Date.now();

  const { site, tried, osm } = await findOfficialSite({
    name, siren: d.siren, commune: d.commune, website: account.website,
  }, { http });

  const domain = site ? rootDomain(site.host) : (account.domain || null);
  const [dns, notices, news] = await Promise.all([
    domain ? dnsIntel(domain).catch(() => null) : null,
    isPublicBuyer(d) ? fetchItNotices(name).catch((e) => ({ error: e.message })) : null,
    fetchCompanyNews(name).catch(() => []),
  ]);

  const emails = site?.emails || [];
  const companyEmails = emails.filter((e) => !domain || rootDomain(e.split("@")[1]) === domain);
  const tech = [...(site?.tech || [])];
  for (const s of dns?.services || []) {
    if (!tech.some((t) => t.label === s)) tech.push({ label: s, cat: "Services (DNS)" });
  }

  return {
    collected_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    site: site ? {
      url: site.url, title: site.title, match: site.match, origin: site.origin,
      hoster: site.hoster, careers_url: site.careers_url, pages: site.pages,
    } : null,
    tried,
    phones: [...new Set([...(site?.phones || []), ...(osm?.phone ? [formatPhone(osm.phone)].filter(Boolean) : [])])]
      .slice(0, 4).map((p) => ({ number: p, kind: phoneKind(p) })),
    news,
    osm: osm?.osm || null,
    emails: {
      generic: companyEmails.filter(isGenericEmail).slice(0, 5),
      named: companyEmails.filter((e) => !isGenericEmail(e)).slice(0, 6),
      other: emails.filter((e) => !companyEmails.includes(e)).slice(0, 3),
    },
    socials: site?.socials || {},
    tech,
    dns,
    leaders_emails: guessLeaderEmails(d.dirigeants, emails, domain, dns?.has_mx),
    public_contracts: Array.isArray(notices) ? notices : null,
    public_contracts_error: notices && !Array.isArray(notices) ? notices.error : null,
  };
}

/** Collecte + enregistrement sur le compte. */
export async function collectAndSave(supabase, account, opts) {
  const intel = await collectAccountIntel(account, opts);
  const update = { web_intel: intel, web_intel_at: intel.collected_at };
  if (intel.site && !account.website) update.website = intel.site.url;
  if (intel.site && !account.domain) update.domain = rootDomain(hostOf(intel.site.url));
  const { error } = await supabase.from("accounts").update(update).eq("id", account.id);
  if (error) throw new Error(error.message);
  // Mode gratuit : la fiche d'approche suit les données fraîches (sans IA,
  // instantané). Une fiche faite par l'IA n'est jamais écrasée.
  if (!aiEnabled() && account.health_status !== "fermee" && (!account.call_prep || account.call_prep.mode === "gratuit")) {
    await saveFreeCallPrep(supabase, { ...account, ...update }).catch((e) => console.error(`[fiche gratuite] ${e.message}`));
  }
  return intel;
}

/** Comptes Salesforce à collecter (jamais faits, ou plus vieux que `days`). */
export async function pendingIntelAccounts(supabase, { limit = 10, days = 30 } = {}) {
  const before = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await supabase
    .from("accounts")
    .select("id, name, website, domain, health_status, health_detail, web_intel_at, call_prep")
    .eq("source", "salesforce")
    .in("health_status", ["active", "vigilance"])
    .or(`web_intel_at.is.null,web_intel_at.lt.${before}`)
    .order("web_intel_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  return data || [];
}
