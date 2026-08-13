import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEnvConfig } from "@/lib/constants";
import { checkMonthlyBudget, budgetMessage, dailyLlmCount } from "@/lib/budget";
import { runResearch } from "@/lib/research";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request) {
  const supabase = getSupabase();
  const { prospectId, force = false } = await request.json();

  const { data: prospect, error } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .single();
  if (error || !prospect) {
    return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });
  }

  const { dailyCap } = getEnvConfig();

  // Même compteur que le drain autonome : les deux chemins puisent dans la même
  // enveloppe quotidienne, ils doivent donc la mesurer de la même façon.
  const dailyCount = await dailyLlmCount(supabase);
  if (dailyCount >= dailyCap) {
    return NextResponse.json(
      { error: "Plafond quotidien de recherches atteint (sécurité budget). Modifiable via DAILY_RESEARCH_CAP." },
      { status: 429 }
    );
  }

  // Kill-switch budget mensuel : coupe net si la dépense Anthropic du mois a
  // atteint MONTHLY_BUDGET_EUR (reprise automatique au 1er du mois suivant).
  const budgetState = await checkMonthlyBudget(supabase);
  if (budgetState.exceeded) {
    return NextResponse.json({ error: budgetMessage(budgetState) }, { status: 429 });
  }

  try {
    const { research } = await runResearch(supabase, prospect, { force });
    return NextResponse.json({ research });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
