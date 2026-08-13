import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { briefSystemPrompt, briefUserPrompt } from "@/lib/prompts-brief";
import { validateBrief } from "@/lib/schemas";
import { logAiRun } from "@/lib/ai-runs";
import { logEvent } from "@/lib/events";
import { checkMonthlyBudget, budgetMessage } from "@/lib/budget";
import { getEnvConfig, MODEL_SONNET } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // web_search (Fluid Compute : jusqu'à 300 s même en Hobby)

// POST /api/brief { prospectId, force? }
// Brief commercial à la demande : DISC + changements récents + accroches + entourage.
// Coûteux (Sonnet + web_search) → déclenché MANUELLEMENT par l'utilisateur et borné
// par le kill-switch budget mensuel. Mis en cache : ne re-dépense pas sans force=true.
export async function POST(request) {
  const supabase = getSupabase();
  const { prospectId, force = false } = await request.json().catch(() => ({}));

  const { data: prospect, error } = await supabase
    .from("prospects").select("*").eq("id", prospectId).single();
  if (error || !prospect) return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });

  // Cache : un brief existe et on ne force pas → on le renvoie sans dépenser.
  if (!force) {
    const { data: existing } = await supabase
      .from("prospect_briefs").select("*").eq("prospect_id", prospectId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) return NextResponse.json({ brief: existing, cached: true });
  }

  // Kill-switch budget mensuel (€) — l'analyse approfondie reste sous le plafond.
  const budget = await checkMonthlyBudget(supabase);
  if (budget.exceeded) {
    return NextResponse.json(
      { error: budgetMessage(budget) },
      { status: 429 }
    );
  }

  const { maxSearches } = getEnvConfig();
  const [{ data: settings }, { data: research }] = await Promise.all([
    supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("research").select("summary, signals").eq("prospect_id", prospectId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  try {
    const { json: raw, usage, webSearchCount } = await callClaudeJson({
      system: briefSystemPrompt(),
      user: briefUserPrompt({ prospect, research, offer: settings?.offer, sender: settings }),
      maxTokens: 3000,
      webSearch: true,
      maxSearches,
      model: MODEL_SONNET,
    });

    const result = validateBrief(raw);

    const { data: saved, error: insErr } = await supabase
      .from("prospect_briefs")
      .insert({
        prospect_id: prospectId,
        disc: result.disc,
        changements_recents: result.changements_recents,
        accroches: result.accroches,
        entourage: result.entourage,
        synthese_approche: result.synthese_approche,
        sources: result.sources,
      })
      .select().single();
    if (insErr) throw new Error(insErr.message);

    await logAiRun({ route: "brief", prospectId, usage, webSearchCount, model: MODEL_SONNET });
    logEvent({ kind: "enrich_done", prospectId, note: "Brief commercial généré" });

    return NextResponse.json({ brief: saved });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
