import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { analyzeAccount } from "@/lib/account-analyze";
import { getEnvConfig } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // recherche web (Fluid Compute : jusqu'à 300 s même en Hobby)

export async function POST(request) {
  const supabase = getSupabase();
  const { accountId, force = false } = await request.json();

  const { data: account, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (error || !account) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }

  const { dailyCap, freshnessTtlDays } = getEnvConfig();

  // QW2 — Cache de fraîcheur : skip l'analyse si la fiche est déjà à jour.
  // Le paramètre force=true (depuis la UI "Forcer la mise à jour") contourne le cache.
  if (!force && account.last_refreshed_at) {
    const ageMs = Date.now() - new Date(account.last_refreshed_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < freshnessTtlDays) {
      return NextResponse.json({ account, counts: null, cached: true });
    }
  }

  // Garde-fou budget : plafond quotidien partagé avec la recherche prospect.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("accounts")
    .select("*", { count: "exact", head: true })
    .gte("last_refreshed_at", since);
  if ((count ?? 0) >= dailyCap) {
    return NextResponse.json(
      { error: "Plafond quotidien atteint (sécurité budget). Modifiable via DAILY_RESEARCH_CAP." },
      { status: 429 }
    );
  }

  try {
    const counts = await analyzeAccount(supabase, account);
    const { data: refreshed } = await supabase.from("accounts").select("*").eq("id", accountId).single();
    return NextResponse.json({ account: refreshed, counts });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
