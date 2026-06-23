import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Agrège les données des tables ai_runs, prospects, events pour le tableau de bord analytique.
// 4 requêtes Supabase + calculs JS — aucun LLM, aucun appel externe.
export async function GET() {
  const supabase = getSupabase();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: prospects },
    { data: aiRuns },
    { data: events },
    { data: researchRows },
  ] = await Promise.all([
    supabase.from("prospects").select("status, fit_score, created_at"),
    supabase.from("ai_runs").select("route, cost_eur, input_tokens, output_tokens, web_search_count, created_at").gte("created_at", since30d),
    supabase.from("events").select("kind, occurred_at").gte("occurred_at", since30d),
    supabase.from("research").select("fit_score, created_at").gte("created_at", since30d),
  ]);

  // ── Statuts prospects ─────────────────────────────────────────────────
  const statusCounts = {};
  let totalScoreSum = 0, scoredCount = 0;
  for (const p of prospects || []) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
    if (p.fit_score != null) { totalScoreSum += p.fit_score; scoredCount++; }
  }

  // ── Coûts IA par jour ─────────────────────────────────────────────────
  const costByDay = {};
  const costByRoute = {};
  let totalCost = 0;
  let totalTokensIn = 0, totalTokensOut = 0, totalSearches = 0;

  for (const r of aiRuns || []) {
    const day = (r.created_at || "").slice(0, 10);
    costByDay[day] = (costByDay[day] || 0) + (r.cost_eur || 0);
    costByRoute[r.route] = (costByRoute[r.route] || 0) + (r.cost_eur || 0);
    totalCost += r.cost_eur || 0;
    totalTokensIn += r.input_tokens || 0;
    totalTokensOut += r.output_tokens || 0;
    totalSearches += r.web_search_count || 0;
  }

  // Compléter les jours vides sur 30 jours pour le graphe
  const costByDayArray = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    costByDayArray.push({ day: key, cost: +(costByDay[key] || 0).toFixed(4) });
  }

  // ── Événements par type ───────────────────────────────────────────────
  const eventsByKind = {};
  for (const e of events || []) {
    eventsByKind[e.kind] = (eventsByKind[e.kind] || 0) + 1;
  }

  // ── Scores de fit (30 jours) ──────────────────────────────────────────
  const recentScores = (researchRows || []).map((r) => r.fit_score).filter((s) => s != null);
  const avgRecentScore = recentScores.length
    ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length)
    : null;

  return NextResponse.json({
    prospects: {
      total: (prospects || []).length,
      by_status: statusCounts,
      avg_fit_score: scoredCount ? Math.round(totalScoreSum / scoredCount) : null,
    },
    ai: {
      total_cost_eur: +totalCost.toFixed(4),
      runs: (aiRuns || []).length,
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
      web_searches: totalSearches,
      by_route: Object.fromEntries(
        Object.entries(costByRoute).map(([k, v]) => [k, +v.toFixed(4)])
      ),
      by_day: costByDayArray,
    },
    events: {
      total: (events || []).length,
      by_kind: eventsByKind,
      rdv_booked: eventsByKind.rdv_booked || 0,
      research_done: eventsByKind.research_done || 0,
    },
    scores: {
      avg_recent: avgRecentScore,
      sample_size: recentScores.length,
    },
  }, {
    // Endpoint de données dynamiques : jamais mis en cache navigateur/proxy,
    // sinon le tableau de bord peut afficher un état périmé (ex. anciens statuts).
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
