// Agent hebdomadaire des leads Salesforce.
//
// Après chaque import (ou sur demande), l'agent met en file `jobs` une fiche
// d'approche (IA + recherche web, ≈ 0,10 €) pour les meilleurs comptes à appeler
// qui n'en ont pas encore : priorité A puis B (lib/lead-priority.js), jamais les
// comptes fermés, en procédure ou clos dans Salesforce. Le worker GitHub Actions
// (toutes les 2 h) et le cron Vercel quotidien drainent la file : aucune page à
// garder ouverte. Plafond glissant sur 7 jours (AGENT_PREP_MAX, défaut 15 ≈ 1,50 €)
// en plus du kill-switch budget mensuel.
//
// ZoomInfo n'est volontairement pas interrogé : licence Dell nominative, accès
// automatisé interdit par ses conditions. La recherche y reste manuelle.
import { listSalesforceLeads } from "@/lib/leads-import";
import { aiEnabled } from "@/lib/constants";
import { isPublicBuyer } from "@/lib/boamp";

export const AGENT_DEFAULT_MAX = 15;
export const agentWeeklyMax = () => {
  const n = Number(process.env.AGENT_PREP_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : AGENT_DEFAULT_MAX;
};

const WEEK_MS = 7 * 86400_000;

/** Comptes éligibles, dans l'ordre de priorité (la liste arrive déjà triée). */
export function selectAgentTargets(leads, { room, queued = new Set(), tiers = ["A", "B"] } = {}) {
  if (!room || room <= 0) return [];
  return leads
    .filter((l) => l.health_status === "active"
      && !/closed|rejected/i.test(l.sf_lead_status || "")
      && !l.call_prep_at
      && tiers.includes(l.priority?.tier)
      && !queued.has(l.id))
    .slice(0, room);
}

async function callPrepJobs(supabase, sinceIso) {
  const { data } = await supabase
    .from("jobs")
    .select("payload, status, created_at, done_at, last_error")
    .eq("kind", "call_prep")
    .gte("created_at", sinceIso)
    .limit(2000);
  return data || [];
}

/** Met en file les fiches de la semaine. Renvoie { queued, room, max, already }. */
export async function runLeadsAgent(supabase, now = Date.now()) {
  const max = agentWeeklyMax();
  const since = new Date(now - WEEK_MS).toISOString();
  const recent = await callPrepJobs(supabase, since);
  const { data: open } = await supabase
    .from("jobs").select("payload").eq("kind", "call_prep").in("status", ["pending", "running"]);
  const queued = new Set([...(open || []), ...recent].map((j) => j.payload?.account_id).filter(Boolean));

  // Mode gratuit : les fiches sont faites sans IA par la collecte (pas de file,
  // pas de plafond) ; l'agent ne s'occupe que de la recherche des décideurs.
  const room = aiEnabled() ? Math.max(0, max - recent.length) : 0;
  const leads = await listSalesforceLeads(supabase, now);
  const targets = selectAgentTargets(leads, { room, queued });
  if (targets.length) {
    const { error } = await supabase.from("jobs").insert(
      // scheduled_at décalé d'une seconde par compte : la file respecte l'ordre de priorité.
      targets.map((l, i) => ({
        kind: "call_prep", payload: { account_id: l.id }, status: "pending",
        scheduled_at: new Date(now + i * 1000).toISOString(),
      })),
    );
    if (error) throw new Error(error.message);
  }
  // Recherche des décideurs IT : indépendante du crédit IA, jamais bloquante.
  const scrape = await enqueueLeadScrapes(supabase, leads, now).catch((e) => ({ queued: 0, error: e.message }));
  const sites = await enqueueSiteSearches(supabase, leads, now).catch((e) => ({ queued: 0, error: e.message }));
  const phones = await enqueuePhoneSearches(supabase, leads, now).catch((e) => ({ queued: 0, error: e.message }));
  const emails = await enqueueEmailSearches(supabase, leads, now).catch((e) => ({ queued: 0, error: e.message }));
  return { queued: targets.length, room, max, already: recent.length, names: targets.map((l) => l.name), scrape, sites, phones, emails };
}

// ── Recherche des décideurs IT (worker de scraping, gratuit, sans IA) ──────
// Pour chaque compte A/B actif, un job `scrape_jobs` (découverte LinkedIn des
// postes IT + email par motif / site) traité par le worker GitHub Actions
// (contrôle toutes les 15 min). Résultats : page Scraping, à promouvoir en contacts.
export const SCRAPE_DEFAULT_MAX = 25;
export const LEAD_ROLES = ['"responsable informatique"', "DSI", '"directeur informatique"', '"administrateur systèmes"', '"responsable infrastructure"'];
export const scrapeWeeklyMax = () => {
  const n = Number(process.env.SCRAPE_WEEKLY_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : SCRAPE_DEFAULT_MAX;
};

/** Comptes à envoyer au worker : actifs, A/B, jamais scrapés (ni en file). */
export function selectScrapeTargets(leads, { room, already = new Set(), tiers = ["A", "B"] } = {}) {
  if (!room || room <= 0) return [];
  return leads
    .filter((l) => (l.health_status === "active") && !/closed|rejected/i.test(l.sf_lead_status || "")
      && tiers.includes(l.priority?.tier) && !already.has(l.id))
    .slice(0, room);
}

export async function enqueueLeadScrapes(supabase, leads, now = Date.now()) {
  const max = scrapeWeeklyMax();
  const ids = leads.map((l) => l.id);
  if (!ids.length || !max) return { queued: 0, max };
  const { data: existing } = await supabase
    .from("scrape_jobs").select("params, created_at, created_by").in("params->>account_id", ids).limit(5000);
  const already = new Set((existing || []).map((j) => j.params?.account_id).filter(Boolean));
  const since = new Date(now - WEEK_MS).toISOString();
  const { count } = await supabase
    .from("scrape_jobs").select("id", { count: "exact", head: true })
    .eq("created_by", "leads-agent").gte("created_at", since);
  const room = Math.max(0, max - (count || 0));
  const targets = selectScrapeTargets(leads, { room, already });
  if (targets.length) {
    const { error } = await supabase.from("scrape_jobs").insert(targets.map((l) => ({
      kind: "discover_and_enrich",
      params: {
        account_id: l.id,
        company: String(l.successor?.confidence === "forte" ? l.successor.name : (l.sirene_name || l.name)).replace(/\s*\(.*?\)\s*/g, " ").trim(),
        domain: "", limit: 6,
        // PME : rarement un « DSI » ; on cherche aussi les postes IT de terrain.
        roles: LEAD_ROLES,
        strict_match: true,      // profil gardé seulement s'il cite la société
        no_guess_domain: true,   // pas d'email inventé sans domaine vérifié
      },
      created_by: "leads-agent",
    })));
    if (error) throw new Error(`scrape_jobs : ${error.message}`);
  }
  return { queued: targets.length, max, room };
}

// ── Recherche du site officiel (agent SearXNG du worker, gratuit) ──────────
// Comptes actifs déjà passés par la collecte web sans site trouvé : le worker
// cherche le site dans son moteur local et ne le retient que si le SIREN y
// figure. Toutes priorités confondues (c'est gratuit), une fois par compte.
export const FIND_SITE_DEFAULT_MAX = 60;

// SCI, sociétés civiles et holdings n'ont presque jamais de site : on ne les
// cherche pas (moins de requêtes, moins de faux positifs).
export function unlikelyWebsite(lead) {
  const nj = String(lead.nature_juridique || "");
  const naf = String(lead.naf || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return /^65/.test(nj) || /^\s*SCI\b/i.test(lead.sirene_name || lead.name || "") || ["6420Z", "6820A", "6820B", "6832A"].includes(naf);
}

export function selectSiteTargets(leads, { room, already = new Set() } = {}) {
  if (!room || room <= 0) return [];
  return leads
    .filter((l) => ["active", "vigilance"].includes(l.health_status) && l.siren && l.intel
      && !l.intel.site && !l.website && !already.has(l.id) && !unlikelyWebsite(l))
    .slice(0, room);
}

export async function enqueueSiteSearches(supabase, leads, now = Date.now()) {
  const n = Number(process.env.FIND_SITE_WEEKLY_MAX);
  const max = Number.isFinite(n) && n >= 0 ? Math.floor(n) : FIND_SITE_DEFAULT_MAX;
  const ids = leads.map((l) => l.id);
  if (!ids.length || !max) return { queued: 0, max };
  const { data: existing } = await supabase
    .from("scrape_jobs").select("params").eq("kind", "find_website").in("params->>account_id", ids).limit(5000);
  const already = new Set((existing || []).map((j) => j.params?.account_id).filter(Boolean));
  const { count } = await supabase
    .from("scrape_jobs").select("id", { count: "exact", head: true })
    .eq("kind", "find_website").gte("created_at", new Date(now - WEEK_MS).toISOString());
  const targets = selectSiteTargets(leads, { room: Math.max(0, max - (count || 0)), already });
  if (targets.length) {
    const { error } = await supabase.from("scrape_jobs").insert(targets.map((l) => ({
      kind: "find_website",
      params: { account_id: l.id, company: l.sirene_name || l.name, commune: l.commune || "", siren: l.siren },
      created_by: "leads-agent",
    })));
    if (error) throw new Error(`scrape_jobs (site) : ${error.message}`);
  }
  return { queued: targets.length, max };
}

// ── Recherche du standard (agent SearXNG du worker, gratuit) ───────────────
// Chaque lead actif doit avoir un numéro. Tous ceux qui n'en ont pas encore
// sont mis en file dès l'import (le worker saute ceux dont le site a donné un
// numéro entre-temps) : il lit les extraits de résultats de recherche (nom +
// commune) et garde le numéro qui revient pour cette société. Une fois par compte.
export const FIND_PHONE_DEFAULT_MAX = 200;

export function selectPhoneTargets(leads, { room, already = new Set() } = {}) {
  if (!room || room <= 0) return [];
  return leads
    .filter((l) => ["active", "vigilance"].includes(l.health_status) && !/closed|rejected/i.test(l.sf_lead_status || "")
      && !l.standard && !l.contact?.phone && !already.has(l.id))
    .slice(0, room);
}

// v2 : recherche élargie (annuaire service-public pour les acheteurs publics,
// SIREN, nom Salesforce, commune de l'établissement, domaine de la société).
// Les comptes cherchés avec l'ancienne version sont repris une fois.
export const CONTACT_SEARCH_VERSION = 2;

const hostOf = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].toLowerCase();

/** Paramètres des recherches de coordonnées (pur, testé). */
export function contactJobParams(l) {
  const company = l.sirene_name || l.name;
  return {
    account_id: l.id, company, commune: l.commune || "",
    alt: l.name && l.name !== company ? l.name : null,
    siren: l.siren || null,
    public: isPublicBuyer({ naf: l.naf, nature_juridique: l.nature_juridique }),
    etab_commune: l.etab_commune || null,
    domain: hostOf(l.domain || l.website || l.intel?.site || "") || null,
    v: CONTACT_SEARCH_VERSION,
  };
}

async function alreadySearched(supabase, kind, ids) {
  const { data: existing } = await supabase
    .from("scrape_jobs").select("params").eq("kind", kind).in("params->>account_id", ids).limit(5000);
  return new Set((existing || [])
    .filter((j) => Number(j.params?.v || 1) >= CONTACT_SEARCH_VERSION)
    .map((j) => j.params?.account_id).filter(Boolean));
}

export async function enqueuePhoneSearches(supabase, leads, now = Date.now()) {
  const ids = leads.map((l) => l.id);
  if (!ids.length) return { queued: 0 };
  const already = await alreadySearched(supabase, "find_phone", ids);
  const { count } = await supabase
    .from("scrape_jobs").select("id", { count: "exact", head: true })
    .eq("kind", "find_phone").gte("created_at", new Date(now - WEEK_MS).toISOString());
  const targets = selectPhoneTargets(leads, { room: Math.max(0, FIND_PHONE_DEFAULT_MAX - (count || 0)), already });
  if (targets.length) {
    const { error } = await supabase.from("scrape_jobs").insert(targets.map((l) => ({
      kind: "find_phone", params: contactJobParams(l), created_by: "leads-agent",
    })));
    if (error) throw new Error(`scrape_jobs (standard) : ${error.message}`);
  }
  return { queued: targets.length };
}

// ── Recherche d'un email (même agent SearXNG) ─────────────────────────────
// Leads actifs sans email sûr ou probable : on cherche l'adresse de la société
// dans les extraits de résultats (domaine de la société, ou adresse de TPE
// type nom@orange.fr). Une fois par compte.
export function selectEmailTargets(leads, { room, already = new Set() } = {}) {
  if (!room || room <= 0) return [];
  return leads
    .filter((l) => ["active", "vigilance"].includes(l.health_status) && !/closed|rejected/i.test(l.sf_lead_status || "")
      && (!l.email || l.email.confidence === "supposé") && !already.has(l.id))
    .slice(0, room);
}

export async function enqueueEmailSearches(supabase, leads, now = Date.now()) {
  const ids = leads.map((l) => l.id);
  if (!ids.length) return { queued: 0 };
  const already = await alreadySearched(supabase, "find_email", ids);
  const { count } = await supabase
    .from("scrape_jobs").select("id", { count: "exact", head: true })
    .eq("kind", "find_email").gte("created_at", new Date(now - WEEK_MS).toISOString());
  const targets = selectEmailTargets(leads, { room: Math.max(0, FIND_PHONE_DEFAULT_MAX - (count || 0)), already });
  if (targets.length) {
    const { error } = await supabase.from("scrape_jobs").insert(targets.map((l) => ({
      kind: "find_email", params: contactJobParams(l), created_by: "leads-agent",
    })));
    if (error) throw new Error(`scrape_jobs (email) : ${error.message}`);
  }
  return { queued: targets.length };
}

/** État de l'agent sur 7 jours, pour la page Leads. */
export async function leadsAgentStatus(supabase, now = Date.now()) {
  const jobs = await callPrepJobs(supabase, new Date(now - WEEK_MS).toISOString());
  const count = (s) => jobs.filter((j) => j.status === s).length;
  const lastError = jobs.filter((j) => j.last_error).map((j) => j.last_error).pop() || null;
  const { data: sj } = await supabase
    .from("scrape_jobs").select("status, kind").eq("created_by", "leads-agent").limit(5000);
  const tally = (rows) => rows.reduce((m, j) => ((m[j.status] = (m[j.status] || 0) + 1), m), {});
  const scrape = tally((sj || []).filter((j) => j.kind !== "find_website"));
  const sites = tally((sj || []).filter((j) => j.kind === "find_website"));
  return {
    scrape,
    sites,
    ai_enabled: aiEnabled(),
    max: agentWeeklyMax(),
    week: jobs.length,
    pending: count("pending") + count("running"),
    done: count("done"),
    error: count("error"),
    last_error: lastError,
  };
}
