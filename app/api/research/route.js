import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getEnvConfig } from "@/lib/constants";
import { checkMonthlyBudget } from "@/lib/budget";
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

  const dailySince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await supabase
    .from("research")
    .select("*", { count: "exact", head: true })
    .gte("created_at", dailySince);
  if ((dailyCount ?? 0) >= dailyCap) {
    return NextResponse.json(
      { error: "Plafond quotidien de recherches atteint (sécurité budget). Modifiable via DAILY_RESEARCH_CAP." },
      { status: 429 }
    );
  }

  // Kill-switch budget mensuel : coupe net si la dépense Anthropic du mois a
  // atteint MONTHLY_BUDGET_EUR (reprise automatique au 1er du mois suivant).
  const { exceeded, spent, budget } = await checkMonthlyBudget(supabase);
  if (exceeded) {
    return NextResponse.json(
      { error: `Budget mensuel atteint (${spent.toFixed(2)} € / ${budget} €). Reprise le 1er du mois prochain, ou augmente MONTHLY_BUDGET_EUR.` },
      { status: 429 }
    );
  }

  try {
    const { research } = await runResearch(supabase, prospect, { force });
    return NextResponse.json({ research });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
