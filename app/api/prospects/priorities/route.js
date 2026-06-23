import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { computeNba } from "@/lib/nba";

export const dynamic = "force-dynamic";

// Retourne les 10 prospects actifs triés par priorité NBA.
// 3 requêtes SQL, aucun appel LLM.
export async function GET() {
  const supabase = getSupabase();

  const { data: prospects } = await supabase
    .from("prospects")
    .select("id, first_name, last_name, role, company, status, fit_score, email, phone, account_id, researched_at, do_not_contact, follow_up_at, next_action")
    .not("status", "in", '("refuse","client")')
    .eq("do_not_contact", false)
    .order("fit_score", { ascending: false, nullsFirst: false })
    .limit(80);

  if (!prospects?.length) return NextResponse.json({ priorities: [] });

  const ids = prospects.map((p) => p.id);

  // Dernière recherche et dernier brouillon par prospect (bulk, pas N+1).
  const [{ data: researchRows }, { data: draftRows }] = await Promise.all([
    supabase
      .from("research")
      .select("prospect_id, id, signals, created_at")
      .in("prospect_id", ids)
      .order("created_at", { ascending: false }),
    supabase
      .from("drafts")
      .select("prospect_id, id, created_at")
      .in("prospect_id", ids)
      .order("created_at", { ascending: false }),
  ]);

  // Index par prospect_id — on garde uniquement le plus récent.
  const researchMap = {};
  for (const r of researchRows || []) {
    if (!researchMap[r.prospect_id]) researchMap[r.prospect_id] = r;
  }
  const draftsMap = {};
  for (const d of draftRows || []) {
    if (!draftsMap[d.prospect_id]) draftsMap[d.prospect_id] = d;
  }

  const scored = prospects.map((p) => ({
    ...p,
    nba: computeNba({
      prospect: p,
      research: researchMap[p.id] || null,
      drafts: draftsMap[p.id] || null,
    }),
  }));

  scored.sort((a, b) => b.nba.priority - a.nba.priority);

  return NextResponse.json({ priorities: scored.slice(0, 10) });
}
