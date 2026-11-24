// Pipeline gratuit des leads, appelé dès l'import puis toutes les 2 h :
//   1. doublons sûrs fusionnés, groupes renseignés ;
//   2. décideurs trouvés par le worker de scraping → contacts du compte ;
//   3. fiche d'approche (gratuite) régénérée quand un contact arrive ;
//   4. déclenchement immédiat des workers GitHub (recherche de site, décideurs).
import { autoMergeDuplicates } from "@/lib/account-merge";
import { saveFreeCallPrep } from "@/lib/call-prep";
import { aiEnabled } from "@/lib/constants";

const nameKey = (f, l) => `${f || ""} ${l || ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function splitFullName(full) {
  const parts = String(full || "").replace(/\s+/g, " ").trim().split(" ");
  if (parts.length < 2) return { first: parts[0] || "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** Lignes account_contacts à créer à partir des résultats du worker (pur). */
export function scrapeRowsToContacts(results, existingByAccount, month = new Date().toISOString().slice(0, 7)) {
  const out = [];
  const seen = new Map(Object.entries(existingByAccount).map(([k, v]) => [k, new Set(v)]));
  for (const r of results) {
    if (!r.account_id || !r.full_name) continue;
    const { first, last } = splitFullName(r.full_name);
    if (!last) continue;
    const set = seen.get(r.account_id) || new Set();
    const key = nameKey(first, last);
    if (set.has(key)) continue;
    set.add(key);
    seen.set(r.account_id, set);
    out.push({
      account_id: r.account_id,
      first_name: first,
      last_name: last,
      role: (r.title || "").slice(0, 200),
      linkedin_url: r.linkedin_url || "",
      email: r.email || "",
      email_confidence: r.email ? (r.email_confidence || "basse") : null,
      email_source: r.email ? (r.email_source || "motif") : null,
      source: "Recherche LinkedIn publique (worker)",
      reliability: "partiel",
      role_confidence: "probable",
      data_date: month,
    });
  }
  return out;
}

/** Décideurs trouvés pour les leads → contacts ; renvoie les comptes touchés. */
export async function promoteLeadScrapes(supabase, { limit = 300 } = {}) {
  const { data: results } = await supabase
    .from("scrape_results")
    .select("account_id, full_name, title, linkedin_url, email, email_confidence, email_source, accounts!inner(source)")
    .eq("accounts.source", "salesforce")
    .not("account_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!results?.length) return { added: 0, accounts: [] };
  const ids = [...new Set(results.map((r) => r.account_id))];
  const { data: existing } = await supabase.from("account_contacts").select("account_id, first_name, last_name").in("account_id", ids);
  const byAcc = {};
  for (const c of existing || []) (byAcc[c.account_id] ||= []).push(nameKey(c.first_name, c.last_name));
  const rows = scrapeRowsToContacts(results, byAcc);
  if (!rows.length) return { added: 0, accounts: [] };
  const { error } = await supabase.from("account_contacts").insert(rows);
  if (error) throw new Error(`contacts : ${error.message}`);
  return { added: rows.length, accounts: [...new Set(rows.map((r) => r.account_id))] };
}

/** Lance tout de suite les workers GitHub (sinon les crons prennent le relais). */
export async function dispatchWorkers(eventType = "leads") {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return { dispatched: false, reason: "GITHUB_DISPATCH_TOKEN / GITHUB_REPO absents" };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "fox-prospect",
      },
      body: JSON.stringify({ event_type: eventType }),
    });
    return { dispatched: res.status === 204, status: res.status };
  } catch (e) {
    return { dispatched: false, reason: e.message };
  }
}

/** Étapes gratuites communes (import et cron). */
export async function runLeadsHousekeeping(supabase, leads) {
  const out = {};
  out.merged = await autoMergeDuplicates(supabase, leads).catch((e) => [{ error: e.message }]);
  const promo = await promoteLeadScrapes(supabase).catch((e) => ({ added: 0, accounts: [], error: e.message }));
  out.contacts_added = promo.added;
  if (promo.error) out.contacts_error = promo.error;
  // Un nouveau contact change la fiche : on la régénère (jamais une fiche IA).
  if (!aiEnabled() && promo.accounts.length) {
    const { data: accs } = await supabase.from("accounts").select("*").in("id", promo.accounts);
    for (const a of accs || []) {
      if (!a.call_prep || a.call_prep.mode === "gratuit") await saveFreeCallPrep(supabase, a).catch(() => {});
    }
  }
  return out;
}

/** Avancement de la recherche sur les leads actifs (pour la page Leads). */
export async function leadsProgress(supabase) {
  let { data, error } = await supabase
    .from("accounts")
    .select("health_status, web_intel_at, call_prep, health_checked_at, standard_phone, phones:web_intel->phones")
    .eq("source", "salesforce")
    .limit(3000);
  if (error) ({ data } = await supabase.from("accounts")
    .select("health_status, web_intel_at, call_prep, health_checked_at").eq("source", "salesforce").limit(3000));
  const rows = data || [];
  const active = rows.filter((r) => ["active", "vigilance"].includes(r.health_status));
  const pending = (q) => q.in("status", ["pending", "running"]);
  const count = () => supabase.from("scrape_jobs").select("id", { count: "exact", head: true });
  const [{ count: sitesPending }, { count: peoplePending }, { count: phonesPending }] = await Promise.all([
    pending(count().eq("kind", "find_website")),
    pending(count().eq("created_by", "leads-agent").not("kind", "in", "(find_website,find_phone,find_email)")),
    pending(count().in("kind", ["find_phone", "find_email"])),
  ]);
  const hasPhone = (r) => !!r.standard_phone || (Array.isArray(r.phones) && r.phones.length > 0) || !!r.call_prep?.coordonnees?.standard;
  return {
    total: rows.length,
    checked: rows.filter((r) => r.health_checked_at).length,
    active: active.length,
    collected: active.filter((r) => r.web_intel_at).length,
    fiches: active.filter((r) => r.call_prep).length,
    with_contact: active.filter((r) => (r.call_prep?.contacts || []).length > 0).length,
    with_phone: active.filter(hasPhone).length,
    sites_pending: sitesPending || 0,
    people_pending: peoplePending || 0,
    phones_pending: phonesPending || 0,
  };
}
