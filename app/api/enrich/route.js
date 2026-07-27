import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { enrichSystemPrompt, enrichUserPrompt } from "@/lib/prompts-enrich";
import { validateEnrich } from "@/lib/schemas";
import { logAiRun } from "@/lib/ai-runs";
import { getEnvConfig, MODEL_HAIKU } from "@/lib/constants";
import { checkMonthlyBudget } from "@/lib/budget";
import { deterministicEnrich } from "@/lib/enrich";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // recherche web (Fluid Compute : jusqu'à 300 s même en Hobby)

export async function POST(request) {
  const supabase = getSupabase();
  const { prospectId } = await request.json();

  const { data: prospect, error } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .single();
  if (error || !prospect) {
    return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });
  }

  const { maxSearches } = getEnvConfig();

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
    // S2 — chemin déterministe d'abord (pattern + MX, zéro token) : couvre le
    // cas nominal. Le LLM ne sert plus qu'en repli (domaine inconnu, pas de MX).
    const det = await deterministicEnrich(supabase, prospect);
    if (det) {
      const update = {
        email_confidence: det.email_confidence,
        email_source: det.email_source,
      };
      if (det.email && !prospect.email) update.email = det.email;

      const { data: saved, error: updateError } = await supabase
        .from("prospects")
        .update(update)
        .eq("id", prospectId)
        .select()
        .single();
      if (updateError) throw new Error(updateError.message);

      return NextResponse.json({ prospect: saved, enrichment: { ...det, phone: "" }, deterministic: true });
    }

    const { json: raw, usage, webSearchCount } = await callClaudeJson({
      system: enrichSystemPrompt(),
      user: enrichUserPrompt({ prospect }),
      maxTokens: 1500,
      webSearch: true,
      maxSearches,
      model: MODEL_HAIKU,
    });

    const result = validateEnrich(raw);

    // On ne remplace jamais un email saisi à la main : s'il existe déjà et
    // diffère du candidat, l'UI propose la suggestion sans écraser.
    const update = {
      email_confidence: result.email_confidence,
      email_source: result.email_source,
    };
    if (result.email && !prospect.email) update.email = result.email;
    if (result.phone && !prospect.phone) update.phone = result.phone;

    const { data: saved, error: updateError } = await supabase
      .from("prospects")
      .update(update)
      .eq("id", prospectId)
      .select()
      .single();
    if (updateError) throw new Error(updateError.message);

    logAiRun({ route: "enrich", prospectId, usage, webSearchCount, model: MODEL_HAIKU });

    return NextResponse.json({ prospect: saved, enrichment: result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
