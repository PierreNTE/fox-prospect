import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { computeAccountHeat } from "@/lib/scoring";
import { getCompanySignalsByAccount, mergeSignals } from "@/lib/signals";

export const dynamic = "force-dynamic";

// Retourne les comptes triés par heat score (urgence des signaux avec decay temporel).
// Utilisé par le dashboard "Comptes chauds". Ne consomme aucun token LLM.
// S5 : fusionne les signaux collectés (company_signals — BOAMP, France Travail,
// quotidiens) avec les signaux d'analyse (JSONB, rafraîchis tous les 14 j) —
// un RFP publié hier chauffe le compte aujourd'hui, pas à la prochaine analyse.
export async function GET(request) {
  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") || 10), 50);

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, name, sector, signals, news, last_refreshed_at, auto_watch, company_id")
    .eq("auto_watch", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const collectedByAccount = await getCompanySignalsByAccount(
    supabase,
    (accounts || []).map((a) => a.id),
    (accounts || []).map((a) => a.company_id).filter(Boolean)
  );

  const scored = (accounts || [])
    .map((a) => {
      const collected = [
        ...(collectedByAccount.get(a.id) || []),
        ...(a.company_id ? collectedByAccount.get(`company:${a.company_id}`) || [] : []),
      ];
      const signals = mergeSignals(collected, a.signals || []);
      return {
        id: a.id,
        name: a.name,
        sector: a.sector,
        last_refreshed_at: a.last_refreshed_at,
        heat_score: computeAccountHeat({ signals }),
        signals: signals.slice(0, 3), // top 3 signaux pour l'affichage
        signals_count: signals.length,
      };
    })
    .sort((a, b) => b.heat_score - a.heat_score)
    .slice(0, limit);

  return NextResponse.json({ accounts: scored });
}
