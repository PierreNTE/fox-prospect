import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { checkMonthlyBudget } from "@/lib/budget";
import { logAiRun } from "@/lib/ai-runs";
import { MODEL_HAIKU } from "@/lib/constants";
import { synthesisSystemPrompt, synthesisUserPrompt } from "@/lib/prompts-ia";

export const dynamic = "force-dynamic";

// IA2 — synthèse d'échange. Mise au propre de notes brutes : tâche simple, pas
// de recherche web → Haiku, coût très faible. Ne stocke rien : la suggestion est
// renvoyée au client, qui la relit avant d'enregistrer l'interaction.
export async function POST(request) {
  const supabase = getSupabase();
  const { prospectId, raw, channel } = await request.json();
  if (!prospectId || !(raw || "").trim()) {
    return NextResponse.json({ error: "prospectId et notes requis." }, { status: 400 });
  }

  const budget = await checkMonthlyBudget(supabase);
  if (budget.exceeded) {
    return NextResponse.json(
      { error: `Plafond mensuel atteint (${budget.spent.toFixed(2)} € / ${budget.budget} €). Reprise le 1er du mois.` },
      { status: 429 }
    );
  }

  const { data: prospect } = await supabase
    .from("prospects")
    .select("first_name, last_name, role, company")
    .eq("id", prospectId)
    .single();
  if (!prospect) return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });

  const { json, usage } = await callClaudeJson({
    system: synthesisSystemPrompt(),
    user: synthesisUserPrompt({ prospect, raw, channel }),
    maxTokens: 1200,
    webSearch: false,
    model: MODEL_HAIKU,
  });

  const days = Number.isFinite(Number(json?.delai_jours)) ? Math.max(0, Math.min(120, Number(json.delai_jours))) : 7;
  const follow = days > 0 ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : null;

  logAiRun({ route: "synthese", prospectId, usage, webSearchCount: 0, model: MODEL_HAIKU });

  return NextResponse.json({
    synthese: {
      compte_rendu: String(json?.compte_rendu || ""),
      points_cles: Array.isArray(json?.points_cles) ? json.points_cles.slice(0, 6) : [],
      objections: Array.isArray(json?.objections) ? json.objections.slice(0, 4) : [],
      next_action: String(json?.next_action || ""),
      sentiment: ["positif", "neutre", "reserve"].includes(json?.sentiment) ? json.sentiment : "neutre",
      follow_up_at: follow,
    },
  });
}
