import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { enrichSystemPrompt, enrichUserPrompt } from "@/lib/prompts-enrich";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // recherche web (Fluid Compute : jusqu'à 300 s même en Hobby)

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

  try {
    const { json: result } = await callClaudeJson({
      system: enrichSystemPrompt(),
      user: enrichUserPrompt({ prospect }),
      maxTokens: 1500,
      webSearch: true,
      maxSearches: Number(process.env.RESEARCH_MAX_SEARCHES) || 4,
    });

    // On ne remplace jamais un email saisi à la main : s'il existe déjà et
    // diffère du candidat, l'UI propose la suggestion sans écraser.
    const update = {
      email_confidence: result.email_confidence || "",
      email_source: result.email_source || "",
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

    return NextResponse.json({ prospect: saved, enrichment: result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
