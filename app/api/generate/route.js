import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { generateSystemPrompt, generateUserPrompt } from "@/lib/prompts";
import { validateGenerate, GENERATE_SCHEMA } from "@/lib/schemas";
import { logAiRun } from "@/lib/ai-runs";
import { logEvent } from "@/lib/events";
import { checkMonthlyBudget, budgetMessage } from "@/lib/budget";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  const supabase = getSupabase();
  const { prospectId, triggerSignal } = await request.json();

  const [{ data: prospect }, { data: researchRows }, { data: settings }] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", prospectId).single(),
    supabase
      .from("research")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("settings").select("*").eq("id", 1).single(),
  ]);

  if (!prospect) return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });

  const research = researchRows?.[0];
  if (!research) {
    return NextResponse.json(
      { error: "Lance d'abord la recherche : les brouillons s'appuient sur les signaux trouvés." },
      { status: 400 }
    );
  }

  // Kill-switch budget mensuel : coupe net si la dépense Anthropic du mois a
  // atteint MONTHLY_BUDGET_EUR (reprise automatique au 1er du mois suivant).
  const budgetState = await checkMonthlyBudget(supabase);
  if (budgetState.exceeded) {
    return NextResponse.json({ error: budgetMessage(budgetState) }, { status: 429 });
  }

  try {
    const { json: raw, usage, webSearchCount } = await callClaudeJson({
      system: generateSystemPrompt(),
      user: generateUserPrompt({ prospect, research, offer: settings?.offer, sender: settings || {}, triggerSignal: triggerSignal || null }),
      maxTokens: 1500,
      webSearch: false,
      schema: GENERATE_SCHEMA,
    });

    const result = validateGenerate(raw);

    const { data: saved, error } = await supabase
      .from("drafts")
      .insert({
        prospect_id: prospectId,
        email_subject: result.email_subject,
        email_body: result.email_body,
        linkedin_message: result.linkedin_message,
        call_points: result.call_points,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    logAiRun({ route: "generate", prospectId, usage, webSearchCount });
    logEvent({ kind: "draft_generated", prospectId });

    return NextResponse.json({ drafts: saved });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
