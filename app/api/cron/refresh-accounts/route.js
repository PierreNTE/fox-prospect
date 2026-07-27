import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { analyzeAccount } from "@/lib/account-analyze";
import { drainJobQueue } from "@/lib/process-jobs";
import { checkMonthlyBudget, budgetMessage } from "@/lib/budget";
import { enqueueAutoQualif } from "@/lib/auto-qualif";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // plusieurs analyses à la suite (Fluid Compute)

// Veille automatique : rafraîchit les comptes les plus anciens.
// Garde-fous budget : seulement les comptes auto_watch=true, par lots, dans la
// limite du plafond quotidien partagé. Déclenché par le cron Vercel (1×/jour).
export async function GET(request) {
  // Protection : le cron Vercel envoie Authorization: Bearer $CRON_SECRET.
  // Tolérant aux espaces/retours à la ligne parasites (copier-coller du secret).
  const secret = (process.env.CRON_SECRET || "").trim();
  if (secret) {
    const auth = (request.headers.get("authorization") || "").trim();
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token !== secret) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  const dailyCap = Number(process.env.DAILY_RESEARCH_CAP) || 50;
  const batch = Number(process.env.WATCH_BATCH) || 2; // nb max de comptes par exécution

  // Kill-switch budget mensuel : la veille autonome ne dépense rien au-delà de
  // MONTHLY_BUDGET_EUR (sinon le cron tournerait tous les jours sans plafond €).
  const budgetState = await checkMonthlyBudget(supabase);
  if (budgetState.exceeded) {
    return NextResponse.json({ refreshed: 0, reason: budgetMessage(budgetState) });
  }

  // Budget déjà consommé sur 24 h (comptes rafraîchis).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: spent } = await supabase
    .from("accounts")
    .select("*", { count: "exact", head: true })
    .gte("last_refreshed_at", since);

  const room = Math.max(0, dailyCap - (spent ?? 0));
  const limit = Math.min(batch, room);
  if (limit === 0) {
    return NextResponse.json({ refreshed: 0, reason: "plafond quotidien atteint" });
  }

  // Comptes à surveiller, les plus anciens d'abord (jamais analysés en tête).
  const { data: accounts } = await supabase
    .from("accounts")
    .select("*")
    .eq("auto_watch", true)
    .order("last_refreshed_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  const done = [];
  for (const account of accounts || []) {
    try {
      const counts = await analyzeAccount(supabase, account);
      done.push({ name: account.name, ...counts });
    } catch (e) {
      done.push({ name: account.name, error: e.message });
    }
  }

  // Qualification autonome : auto-promotion des résultats de scraping + mise en
  // file d'un job research_prospect par prospect non encore recherché
  // (researched_at IS NULL). (AUTO_QUALIFY=off pour désactiver.) Le drain
  // ci-dessous les qualifie, borné par le budget.
  let autoq = null;
  try {
    autoq = await enqueueAutoQualif(supabase);
  } catch (e) {
    autoq = { error: e.message };
  }

  // Puis on draine la file `jobs` (analyze_account + research_prospect) dans le
  // budget restant. Vercel Hobby = 2 crons max : pas de cron dédié à process-jobs,
  // on le greffe ici. drainJobQueue vérifie le kill-switch budget mensuel et ne
  // dépasse jamais le plafond quotidien partagé.
  let queue = null;
  try {
    queue = await drainJobQueue(supabase, { dailyCap });
  } catch (e) {
    queue = { error: e.message };
  }

  return NextResponse.json({ refreshed: done.length, details: done, autoq, queue });
}
