import { getSupabase } from "@/lib/supabase";
import { logEvent } from "@/lib/events";

// Qualification autonome : transforme « scrape auto → tu cliques » en
// « tout auto → fiche prête ». Deux étapes, exécutées en tête du cron de veille :
//   1) auto-promotion des résultats de scraping en prospects (garde-fous qualité
//      + conformité opt-out), comme le clic « Qualifier » le faisait à la main ;
//   2) enfilement d'un job research_prospect par prospect « nouveau » non encore
//      recherché — le drain de la file le qualifie ensuite, borné par le
//      kill-switch budget mensuel (donc jamais au-delà de MONTHLY_BUDGET_EUR).
//
// Désactivable sans redéploiement : AUTO_QUALIFY=off.

export function autoQualifyEnabled() {
  return (process.env.AUTO_QUALIFY || "on").toLowerCase() !== "off";
}

export async function enqueueAutoQualif(supabase = getSupabase()) {
  if (!autoQualifyEnabled()) return { promoted: 0, enqueued: 0, skipped: "AUTO_QUALIFY=off" };

  let promoted = 0;

  // ── 1) Auto-promotion des résultats de scraping non promus ────────────────
  const { data: results } = await supabase
    .from("scrape_results")
    .select("*")
    .is("prospect_id", null)
    .limit(200);

  for (const r of results || []) {
    const fullName = (r.full_name || "").trim();
    const email = (r.email || "").trim();
    if (!fullName) continue;
    if (!email && !r.linkedin_url) continue; // qualité minimale : nom + (email|linkedin)

    if (email) {
      const { data: opt } = await supabase
        .from("optout").select("email").eq("email", email.toLowerCase()).limit(1);
      if (opt && opt.length) continue; // conformité : jamais un opt-out
    }

    const parts = fullName.split(/\s+/);
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || firstName;
    const companyWebsite = email.includes("@") ? `https://${email.split("@")[1]}` : "";

    const { data: prospect, error } = await supabase
      .from("prospects")
      .insert({
        first_name: firstName, last_name: lastName, role: r.title || "",
        company: r.company || "", company_website: companyWebsite,
        linkedin_url: r.linkedin_url || "", email,
        email_confidence: r.email_confidence || "", email_source: r.email_source || "",
        status: "nouveau", account_id: r.account_id || null,
        notes: r.source ? `Importé via scraping — source : ${r.source}` : "",
      })
      .select("id").single();
    if (!error && prospect) {
      await supabase.from("scrape_results").update({ prospect_id: prospect.id }).eq("id", r.id);
      logEvent({ kind: "auto_action", accountId: r.account_id, prospectId: prospect.id, note: "scrape:auto-promoted" });
      promoted++;
    }
  }

  // ── 2) Enfilement de la qualification pour les prospects « nouveau » ───────
  const { data: fresh } = await supabase
    .from("prospects").select("id").eq("status", "nouveau").limit(500);
  const candidateIds = (fresh || []).map((p) => p.id);
  if (candidateIds.length === 0) return { promoted, enqueued: 0 };

  // Exclure ceux déjà recherchés.
  const { data: hasResearch } = await supabase
    .from("research").select("prospect_id").in("prospect_id", candidateIds);
  const researched = new Set((hasResearch || []).map((x) => x.prospect_id));

  // Exclure ceux déjà en file (pending/running).
  const { data: pendingJobs } = await supabase
    .from("jobs").select("payload, status").eq("kind", "research_prospect").in("status", ["pending", "running"]);
  const queued = new Set((pendingJobs || []).map((j) => j.payload?.prospect_id).filter(Boolean));

  const toQueue = candidateIds.filter((id) => !researched.has(id) && !queued.has(id));
  if (toQueue.length === 0) return { promoted, enqueued: 0 };

  const rows = toQueue.map((id) => ({ kind: "research_prospect", payload: { prospect_id: id }, status: "pending" }));
  const { data: ins } = await supabase.from("jobs").insert(rows).select("id");
  return { promoted, enqueued: ins?.length ?? 0 };
}
