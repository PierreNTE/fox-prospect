import { getSupabase } from "@/lib/supabase";
import { logEvent } from "@/lib/events";

// Qualification autonome : transforme « scrape auto → tu cliques » en
// « tout auto → fiche prête ». Deux étapes, exécutées en tête du cron de veille :
//   1) auto-promotion des contacts de account_contacts (sans prospect_id) en prospects
//      (garde-fous qualité + conformité opt-out) ;
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

  // ── 1) Auto-promotion des contacts scrapés non encore promus ──────────────
  const { data: contacts } = await supabase
    .from("account_contacts")
    .select("*, accounts(name, website, domain)")
    .is("prospect_id", null)
    .not("first_name", "eq", "")
    // Exige au moins une coordonnée joignable (email, téléphone ou LinkedIn)
    .or("email.neq.,phone.neq.,linkedin_url.neq.")
    .limit(200);

  for (const c of contacts || []) {
    const firstName = (c.first_name || "").trim();
    const lastName = (c.last_name || "").trim();
    if (!firstName && !lastName) continue;

    const email = (c.email || "").trim();
    const phone = (c.phone || "").trim();
    const linkedin = (c.linkedin_url || "").trim();

    // Garde JS : au moins une coordonnée valide requise
    if (!email && !phone && !linkedin) continue;

    if (email) {
      const { data: opt } = await supabase
        .from("optout").select("email").eq("email", email.toLowerCase()).limit(1);
      if (opt && opt.length) continue;
    }

    const account = c.accounts;
    const companyName = account?.name || "";
    const companyWebsite =
      account?.website ||
      (account?.domain ? `https://${account.domain}` : "") ||
      (email.includes("@") ? `https://${email.split("@")[1]}` : "");

    const { data: prospect, error } = await supabase
      .from("prospects")
      .insert({
        first_name: firstName,
        last_name: lastName,
        role: c.role || "",
        company: companyName,
        company_website: companyWebsite,
        linkedin_url: linkedin,
        email,
        phone,
        email_confidence: "",
        email_source: "",
        status: "nouveau",
        account_id: c.account_id || null,
        notes: c.source ? `Importé via scraping — source : ${c.source}` : "",
      })
      .select("id").single();

    if (!error && prospect) {
      await supabase.from("account_contacts").update({ prospect_id: prospect.id }).eq("id", c.id);
      logEvent({ kind: "auto_action", accountId: c.account_id, prospectId: prospect.id, note: "scrape:auto-promoted" });
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
