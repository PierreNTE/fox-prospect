import { callClaudeJson } from "@/lib/anthropic";
import {
  researchSystemPrompt, researchUserPrompt,
  extractionSystemPrompt, extractionUserPrompt,
  judgmentSystemPrompt, judgmentUserPrompt,
} from "@/lib/prompts";
import { validateResearch } from "@/lib/schemas";
import { logAiRun } from "@/lib/ai-runs";
import { logEvent } from "@/lib/events";
import { getEnvConfig, MODEL_HAIKU, MODEL_SONNET } from "@/lib/constants";

// Cœur de la qualification 2 passes — réutilisé par /api/research (au clic) et
// par le worker de jobs (qualification autonome). Ne porte PAS les garde-fous
// HTTP (plafond quotidien, kill-switch budget) : l'appelant les pose.
//
// Renvoie { research, cached } ; lève en cas d'erreur (l'appelant décide).
export async function runResearch(supabase, prospect, { force = false } = {}) {
  const { freshnessTtlDays, maxSearches } = getEnvConfig();

  // Cache de fraîcheur : évite une dépense en double si une recherche récente existe.
  if (!force) {
    const since = new Date(Date.now() - freshnessTtlDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("research")
      .select("*")
      .eq("prospect_id", prospect.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (recent) return { research: recent, cached: true };
  }

  const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).single();

  let raw;

  // Passe 1 (extraction) sur Haiku par défaut : tâche simple (faits sourcés),
  // ~10x moins chère que Sonnet, web_search actif. Passe 2 (jugement) sur Sonnet.
  const extractModel = process.env.RESEARCH_EXTRACT_MODEL === "sonnet" ? MODEL_SONNET : MODEL_HAIKU;
  let extraction = null;
  try {
    const { json: extractionRaw, usage: u1, webSearchCount: w1 } = await callClaudeJson({
      system: extractionSystemPrompt(),
      user: extractionUserPrompt({ prospect, offer: settings?.offer }),
      maxTokens: 2500,
      webSearch: true,
      maxSearches,
      model: extractModel,
    });
    if (extractionRaw && Array.isArray(extractionRaw.facts)) {
      extraction = extractionRaw;
      logAiRun({ route: "research", prospectId: prospect.id, usage: u1, webSearchCount: w1, model: extractModel });
    }
  } catch {
    // Passe d'extraction échouée : repli mono-passe ci-dessous.
  }

  if (extraction) {
    const { json: judgmentRaw, usage: u2, webSearchCount: w2 } = await callClaudeJson({
      system: judgmentSystemPrompt(),
      user: judgmentUserPrompt({ prospect, extraction, offer: settings?.offer }),
      maxTokens: 2500,
      webSearch: false,
    });
    raw = judgmentRaw;
    logAiRun({ route: "research", prospectId: prospect.id, usage: u2, webSearchCount: w2, model: MODEL_SONNET });
  } else {
    const { json: singleRaw, usage: u, webSearchCount: w } = await callClaudeJson({
      system: researchSystemPrompt(),
      user: researchUserPrompt({ prospect, offer: settings?.offer }),
      maxTokens: 3000,
      webSearch: true,
      maxSearches,
    });
    raw = singleRaw;
    logAiRun({ route: "research", prospectId: prospect.id, usage: u, webSearchCount: w, model: MODEL_SONNET });
  }

  const result = validateResearch(raw);

  const { data: saved, error: insertError } = await supabase
    .from("research")
    .insert({
      prospect_id: prospect.id,
      summary: result.summary,
      signals: result.signals,
      hooks: result.hooks,
      fit_score: result.fit_score,
      fit_reason: result.fit_reason,
      sources: result.sources,
    })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);

  await supabase
    .from("prospects")
    .update({
      fit_score: result.fit_score,
      status: prospect.status === "nouveau" ? "recherché" : prospect.status,
    })
    .eq("id", prospect.id);

  logEvent({ kind: "research_done", prospectId: prospect.id });

  return { research: saved, cached: false };
}
