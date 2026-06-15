import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { computeAccountHeat } from "@/lib/scoring";

export const dynamic = "force-dynamic";

// Retourne les comptes triés par heat score (urgence des signaux avec decay temporel).
// Utilisé par le dashboard "Comptes chauds". Ne consomme aucun token LLM.
export async function GET(request) {
  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") || 10), 50);

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, name, sector, signals, news, last_refreshed_at, auto_watch")
    .eq("auto_watch", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const scored = (accounts || [])
    .map((a) => ({
      id: a.id,
      name: a.name,
      sector: a.sector,
      last_refreshed_at: a.last_refreshed_at,
      heat_score: computeAccountHeat(a),
      signals: (a.signals || []).slice(0, 3), // top 3 signaux pour l'affichage
      signals_count: (a.signals || []).length,
    }))
    .sort((a, b) => b.heat_score - a.heat_score)
    .slice(0, limit);

  return NextResponse.json({ accounts: scored });
}
