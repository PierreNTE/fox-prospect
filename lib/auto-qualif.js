import { getSupabase } from "@/lib/supabase";
import { logEvent } from "@/lib/events";

// Qualification autonome : transforme « scrape auto → tu cliques » en
// « tout auto → fiche prête ». Chaîne complète, exécutée en tête du cron de veille :
//   0) auto-enfilement de jobs de scraping (discover_and_enrich) pour les comptes
//      surveillés sans scraping récent — le worker GitHub Actions les traite et
//      écrit dans scrape_results (LinkedIn + email via proxy) ;
//   1) auto-promotion en prospects des contacts disposant d'au moins une coordonnée,
//      depuis account_contacts (analyse LLM) ET scrape_results (scraper), avec
//      dédup + conformité opt-out ;
//   2) enfilement d'un job research_prospect par prospect non encore recherché
//      (researched_at IS NULL) — le drain de la file le qualifie ensuite, borné
//      par le kill-switch budget mensuel (donc jamais au-delà de MONTHLY_BUDGET_EUR).
//
// Désactivable sans redéploiement : AUTO_QUALIFY=off (toute la chaîne) ou
// AUTO_SCRAPE=off (juste l'enfilement de scraping, ex. pour économiser le proxy).

export function autoQualifyEnabled() {
  return (process.env.AUTO_QUALIFY || "on").toLowerCase() !== "off";
}

export function autoScrapeEnabled() {
  return (process.env.AUTO_SCRAPE || "on").toLowerCase() !== "off";
}

// ── 0) Auto-enfilement de jobs de scraping ───────────────────────────────────
// Crée un job discover_and_enrich pour les comptes surveillés qui n'ont ni job en
// cours ni scraping récent (fenêtre de re-scraping). Borné par run pour lisser la
// charge proxy/Brave. Le worker GitHub Actions (scrape-worker, toutes les 6 h) draine.
async function autoEnqueueScrapeJobs(supabase, perRun, rescanDays) {
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, website, domain")
    .eq("auto_watch", true);
  if (!accounts?.length) return 0;

  // Comptes déjà couverts : job pending/running OU scrapé récemment.
  const since = new Date(Date.now() - rescanDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("scrape_jobs")
    .select("params, status, created_at")
    .or(`status.in.(pending,running),created_at.gte.${since}`);
  const covered = new Set((recent || []).map((j) => j.params?.account_id).filter(Boolean));

  const todo = accounts.filter((a) => !covered.has(a.id)).slice(0, perRun);
  if (!todo.length) return 0;

  const rows = todo.map((a) => ({
    kind: "discover_and_enrich",
    params: {
      account_id: a.id,
      company: a.name || "",
      domain: (a.domain || a.website || "").replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
      limit: 8,
    },
    created_by: "auto",
  }));
  const { data: ins } = await supabase.from("scrape_jobs").insert(rows).select("id");
  return ins?.length ?? 0;
}

// ── 1) Promotion d'un contact en prospect (helper commun) ─────────────────────
// Vérifie opt-out + dédup (LinkedIn/email déjà connus), insère, et renvoie l'id du
// prospect créé (ou null si ignoré). Met à jour les sets de dédup en place.
async function promoteContact(supabase, c, { seenLi, seenEmail }) {
  const firstName = (c.first_name || "").trim();
  const lastName = (c.last_name || "").trim();
  if (!firstName && !lastName) return null;

  const email = (c.email || "").trim();
  const phone = (c.phone || "").trim();
  const linkedin = (c.linkedin_url || "").trim();
  // Exploitable = téléphone OU email obligatoire (LinkedIn seul ne suffit pas).
  if (!email && !phone) return null;

  // Dédup contre les prospects existants (et ceux promus dans ce run).
  if (linkedin && seenLi.has(linkedin.toLowerCase())) return null;
  if (email && seenEmail.has(email.toLowerCase())) return null;

  // Conformité : jamais de promotion d'un email en liste d'opposition.
  if (email) {
    const { data: opt } = await supabase
      .from("optout").select("email").eq("email", email.toLowerCase()).limit(1);
    if (opt && opt.length) return null;
  }

  const companyWebsite =
    c.company_website ||
    (c.domain ? `https://${c.domain}` : "") ||
    (email.includes("@") ? `https://${email.split("@")[1]}` : "");

  const { data: prospect, error } = await supabase
    .from("prospects")
    .insert({
      first_name: firstName,
      last_name: lastName,
      role: c.role || "",
      company: c.company || "",
      company_website: companyWebsite,
      linkedin_url: linkedin,
      email,
      phone,
      email_confidence: c.email_confidence || "",
      email_source: c.email_source || "",
      status: "non_contacte",
      account_id: c.account_id || null,
      notes: c.source ? `Importé via scraping — source : ${c.source}` : "",
    })
    .select("id").single();

  if (error || !prospect) return null;
  if (linkedin) seenLi.add(linkedin.toLowerCase());
  if (email) seenEmail.add(email.toLowerCase());
  return prospect.id;
}

export async function enqueueAutoQualif(supabase = getSupabase()) {
  if (!autoQualifyEnabled()) return { scrapeEnqueued: 0, promoted: 0, enqueued: 0, skipped: "AUTO_QUALIFY=off" };

  // ── 0) Enfilement de jobs de scraping (si activé) ──────────────────────────
  let scrapeEnqueued = 0;
  if (autoScrapeEnabled()) {
    const perRun = Number(process.env.SCRAPE_ENQUEUE_PER_RUN) || 5;
    const rescanDays = Number(process.env.SCRAPE_RESCAN_DAYS) || 30;
    try {
      scrapeEnqueued = await autoEnqueueScrapeJobs(supabase, perRun, rescanDays);
    } catch (e) {
      scrapeEnqueued = 0; // jamais bloquant
    }
  }

  // Sets de dédup partagés entre les deux sources (LinkedIn + email connus).
  const { data: existing } = await supabase.from("prospects").select("linkedin_url, email").limit(5000);
  const seenLi = new Set((existing || []).map((p) => (p.linkedin_url || "").trim().toLowerCase()).filter(Boolean));
  const seenEmail = new Set((existing || []).map((p) => (p.email || "").trim().toLowerCase()).filter(Boolean));

  let promoted = 0;

  // ── 1a) Auto-promotion des contacts account_contacts (analyse LLM) ─────────
  const { data: contacts } = await supabase
    .from("account_contacts")
    .select("*, accounts(name, website, domain)")
    .is("prospect_id", null)
    .not("first_name", "eq", "")
    .or("email.neq.,phone.neq.")
    .limit(200);

  for (const c of contacts || []) {
    const account = c.accounts;
    const id = await promoteContact(
      supabase,
      {
        ...c,
        company: account?.name || "",
        company_website: account?.website || "",
        domain: account?.domain || "",
      },
      { seenLi, seenEmail }
    );
    if (id) {
      await supabase.from("account_contacts").update({ prospect_id: id }).eq("id", c.id);
      logEvent({ kind: "auto_action", accountId: c.account_id, prospectId: id, note: "scrape:auto-promoted" });
      promoted++;
    }
  }

  // ── 1b) Auto-promotion des résultats du scraper (scrape_results) ───────────
  const { data: results } = await supabase
    .from("scrape_results")
    .select("*")
    .is("prospect_id", null)
    .neq("email", "")
    .not("email", "is", null)
    .limit(200);

  for (const r of results || []) {
    const parts = (r.full_name || "").trim().split(/\s+/);
    const id = await promoteContact(
      supabase,
      {
        first_name: parts[0] || "",
        last_name: parts.slice(1).join(" ") || parts[0] || "",
        role: r.title || "",
        company: r.company || "",
        email: r.email || "",
        linkedin_url: r.linkedin_url || "",
        email_confidence: r.email_confidence || "",
        email_source: r.email_source || "",
        account_id: r.account_id || null,
        source: r.source || "",
      },
      { seenLi, seenEmail }
    );
    if (id) {
      await supabase.from("scrape_results").update({ prospect_id: id }).eq("id", r.id);
      logEvent({ kind: "auto_action", accountId: r.account_id, prospectId: id, note: "scrape:auto-promoted-result" });
      promoted++;
    }
  }

  // ── 2) Enfilement de la qualification pour les prospects non encore recherchés ─
  // researched_at IS NULL = jamais qualifié par l'IA (état découplé du statut
  // commercial depuis P2). Requête bornée et indexée (prospects_unresearched_idx).
  const { data: fresh } = await supabase
    .from("prospects").select("id").is("researched_at", null).limit(500);
  const candidateIds = (fresh || []).map((p) => p.id);
  if (candidateIds.length === 0) return { scrapeEnqueued, promoted, enqueued: 0 };

  // Filet de sécurité : exclure ceux qui auraient déjà une recherche (researched_at
  // non posé pour une raison ou une autre).
  const { data: hasResearch } = await supabase
    .from("research").select("prospect_id").in("prospect_id", candidateIds);
  const researched = new Set((hasResearch || []).map((x) => x.prospect_id));

  // Exclure ceux déjà en file (pending/running) ET ceux tombés en échec :
  // un prospect dont le job a épuisé ses 3 tentatives reste parqué en `error`
  // (visible dans Réglages → « File de traitement ») au lieu d'être ré-enfilé
  // à chaque cron — ce cycle avait accumulé 2 867 jobs morts pendant la panne
  // de crédits Anthropic. Pour ré-armer après résolution : purger les jobs
  // `error`, l'enfilement reprend au cron suivant.
  const { data: pendingJobs } = await supabase
    .from("jobs").select("payload, status").eq("kind", "research_prospect").in("status", ["pending", "running", "error"]);
  const queued = new Set((pendingJobs || []).map((j) => j.payload?.prospect_id).filter(Boolean));

  const toQueue = candidateIds.filter((id) => !researched.has(id) && !queued.has(id));
  if (toQueue.length === 0) return { scrapeEnqueued, promoted, enqueued: 0 };

  const rows = toQueue.map((id) => ({ kind: "research_prospect", payload: { prospect_id: id }, status: "pending" }));
  const { data: ins } = await supabase.from("jobs").insert(rows).select("id");
  return { scrapeEnqueued, promoted, enqueued: ins?.length ?? 0 };
}
