import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { researchSystemPrompt, researchUserPrompt } from "@/lib/prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // la recherche web prend du temps

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

  // Garde-fou budget : plafond quotidien de recherches.
  const dailyCap = Number(process.env.DAILY_RESEARCH_CAP) || 50;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await supabase
    .from("research")
    .select("*", { count: "exact", head: true })
    .gte("created_at", since);
  if ((dailyCount ?? 0) >= dailyCap) {
    return NextResponse.json(
      { error: "Plafond quotidien de recherches atteint (sécurité budget). Modifiable via DAILY_RESEARCH_CAP." },
      { status: 429 }
    );
  }

  const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).single();

  try {
    const { json: result } = await callClaudeJson({
      system: researchSystemPrompt(),
      user: researchUserPrompt({ prospect, offer: settings?.offer }),
      maxTokens: 3000,
      webSearch: true,
      maxSearches: Number(process.env.RESEARCH_MAX_SEARCHES) || 4,
    });


    const { data: saved, error: insertError } = await supabase
      .from("research")
      .insert({
        prospect_id: prospectId,
        summary: result.summary || "",
        signals: result.signals || [],
        hooks: result.hooks || [],
        fit_score: result.fit_score ?? null,
        fit_reason: result.fit_reason || "",
        sources: result.sources || [],
      })
      .select()
      .single();
    if (insertError) throw new Error(insertError.message);

    await supabase
      .from("prospects")
      .update({
        fit_score: result.fit_score ?? null,
        status: prospect.status === "nouveau" ? "recherché" : prospect.status,
      })
      .eq("id", prospectId);

    return NextResponse.json({ research: saved });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
