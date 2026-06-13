import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { analyzeAccount } from "@/lib/account-analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // plusieurs analyses à la suite (Fluid Compute)

// Veille automatique : rafraîchit les comptes les plus anciens.
// Garde-fous budget : seulement les comptes auto_watch=true, par lots, dans la
// limite du plafond quotidien partagé. Déclenché par le cron Vercel (1×/jour).
export async function GET(request) {
  // Protection : le cron Vercel envoie Authorization: Bearer $CRON_SECRET.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  const dailyCap = Number(process.env.DAILY_RESEARCH_CAP) || 50;
  const batch = Number(process.env.WATCH_BATCH) || 2; // nb max de comptes par exécution

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

  return NextResponse.json({ refreshed: done.length, details: done });
}
