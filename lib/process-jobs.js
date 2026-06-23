import { analyzeAccount } from "@/lib/account-analyze";
import { runResearch } from "@/lib/research";
import { getEnvConfig } from "@/lib/constants";
import { checkMonthlyBudget } from "@/lib/budget";

// Drainage de la file `jobs` (kind=analyze_account) — logique partagée entre
// la route /api/cron/process-jobs (invocation manuelle) et le cron
// /api/cron/refresh-accounts (autonome, après la veille).
//
// Vercel Hobby = 2 crons max, déjà pris (refresh-accounts + collect-signals).
// Plutôt que d'exiger Vercel Pro pour un 3e cron, la file est vidée en queue
// du cron de veille, dans le BUDGET RESTANT du plafond quotidien partagé
// (compteur = accounts.last_refreshed_at sur 24 h, commun aux deux usages).
//
// Renvoie { done, errors, total, skipped, reason? }.
export async function drainJobQueue(supabase, { dailyCap } = {}) {
  const cap = dailyCap ?? getEnvConfig().dailyCap;

  // Kill-switch budget mensuel : ne draine rien si le plafond € est atteint.
  const budgetState = await checkMonthlyBudget(supabase);
  if (budgetState.exceeded) {
    return { done: 0, errors: 0, total: 0, skipped: 0, reason: `budget mensuel atteint (${budgetState.spent.toFixed(2)} € / ${budgetState.budget} €)` };
  }

  // Budget déjà consommé aujourd'hui (analyses LLM = comptes rafraîchis).
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: spent } = await supabase
    .from("accounts")
    .select("*", { count: "exact", head: true })
    .gte("last_refreshed_at", since24h);

  const room = Math.max(0, cap - (spent ?? 0));
  if (room === 0) {
    return { done: 0, errors: 0, total: 0, skipped: 0, reason: "plafond quotidien atteint" };
  }

  // Cap par exécution : chaque job (analyse/qualif) fait du web_search (~15-30 s)
  // et le drain est séquentiel. Avec maxDuration=300 s, on borne pour ne pas
  // timeouter en laissant des jobs coincés en "running". Le reste part au prochain
  // passage. JOBS_PER_RUN ajustable (défaut 8 → ~8 qualifs/jour ≈ 240/mois).
  const perRun = Number(process.env.JOBS_PER_RUN) || 4;
  const limit = Math.min(room, perRun);

  // Auto-réparation : un job resté "running" > 10 min vient d'un timeout serverless
  // (la fonction est morte avant de le finir). On le repasse en pending pour réessai,
  // sinon il reste zombie indéfiniment. À faire avant de réclamer de nouveaux jobs.
  await supabase
    .from("jobs")
    .update({ status: "pending", started_at: null })
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

  // Réclame les jobs en attente échus (les plus anciens en premier).
  const { data: pending } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  const results = [];

  for (const job of pending || []) {
    // Verrou optimiste : seul le premier worker à passer le update récupère le job.
    const { data: claimed } = await supabase
      .from("jobs")
      .update({ status: "running", started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq("id", job.id)
      .eq("status", "pending")
      .select()
      .single();

    if (!claimed) continue;

    try {
      if (job.kind === "analyze_account") {
        const { data: account } = await supabase
          .from("accounts")
          .select("*")
          .eq("id", job.payload.account_id)
          .single();

        if (!account) throw new Error("Compte introuvable");
        const counts = await analyzeAccount(supabase, account);

        await supabase
          .from("jobs")
          .update({ status: "done", done_at: new Date().toISOString(), last_error: null })
          .eq("id", job.id);

        results.push({ id: job.id, kind: job.kind, ok: true, counts });
      } else if (job.kind === "research_prospect") {
        // Qualification autonome : même cœur 2 passes que le clic « Qualifier ».
        const { data: prospect } = await supabase
          .from("prospects")
          .select("*")
          .eq("id", job.payload.prospect_id)
          .single();

        if (!prospect) throw new Error("Prospect introuvable");
        const { research, cached } = await runResearch(supabase, prospect, { force: false });

        await supabase
          .from("jobs")
          .update({ status: "done", done_at: new Date().toISOString(), last_error: null })
          .eq("id", job.id);

        results.push({ id: job.id, kind: job.kind, ok: true, fit_score: research?.fit_score, cached });
      } else {
        throw new Error(`Kind non géré : ${job.kind}`);
      }
    } catch (e) {
      const maxAttempts = 3;
      const failed = claimed.attempts >= maxAttempts;
      // Retry avec délai exponentiel (30 min, 1h, abandon) ou passage en error.
      const retryDelay = Math.min(60, 30 * claimed.attempts) * 60 * 1000;
      await supabase
        .from("jobs")
        .update({
          status: failed ? "error" : "pending",
          last_error: e.message.slice(0, 500),
          scheduled_at: failed ? undefined : new Date(Date.now() + retryDelay).toISOString(),
        })
        .eq("id", job.id);

      results.push({ id: job.id, kind: job.kind, ok: false, error: e.message });
    }
  }

  const done = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).length;
  return { done, errors, total: results.length, skipped: 0 };
}
