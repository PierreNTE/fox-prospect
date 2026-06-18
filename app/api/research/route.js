import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
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
import { checkMonthlyBudget } from "@/lib/budget";

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

  const { dailyCap, freshnessTtlDays, maxSearches } = getEnvConfig();

  if (!force) {
    const since = new Date(Date.now() - freshnessTtlDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("research")
      .select("*")
      .eq("prospect_id", prospectId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (recent) {
      return NextResponse.json({ research: recent, cached: true });
    }
  }

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

  const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).single();

  try {
    let raw;

    // ── Tentative 2 passes ───────────────────────────────────────────────────
    // Passe 1 (extraction) sur Haiku par défaut : tâche simple (sortir des faits
    // sourcés), ~10x moins chère que Sonnet, web_search reste actif. Passe 2
    // (jugement) garde Sonnet. Coût loggé par passe pour une compta exacte.
    // Soupape : RESEARCH_EXTRACT_MODEL=sonnet rebascule l'extraction sur Sonnet
    // sans redéploiement (à utiliser si l'eval complète montre une dégradation).
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
        logAiRun({ route: "research", prospectId, usage: u1, webSearchCount: w1, model: extractModel });
      }
    } catch {
      // La passe d'extraction a échoué : on tombera sur le fallback mono-passe.
    }

    if (extraction) {
      // Passe 2 : jugement sans web search, ancré sur les faits extraits.
      const { json: judgmentRaw, usage: u2, webSearchCount: w2 } = await callClaudeJson({
        system: judgmentSystemPrompt(),
        user: judgmentUserPrompt({ prospect, extraction, offer: settings?.offer }),
        maxTokens: 2500,
        webSearch: false,
      });
      raw = judgmentRaw;
      logAiRun({ route: "research", prospectId, usage: u2, webSearchCount: w2, model: MODEL_SONNET });
    } else {
      // Fallback : mono-passe (comportement V2), tout sur Sonnet.
      const { json: singleRaw, usage: u, webSearchCount: w } = await callClaudeJson({
        system: researchSystemPrompt(),
        user: researchUserPrompt({ prospect, offer: settings?.offer }),
        maxTokens: 3000,
        webSearch: true,
        maxSearches,
      });
      raw = singleRaw;
      logAiRun({ route: "research", prospectId, usage: u, webSearchCount: w, model: MODEL_SONNET });
    }

    const result = validateResearch(raw);

    const { data: saved, error: insertError } = await supabase
      .from("research")
      .insert({
        prospect_id: prospectId,
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
      .eq("id", prospectId);

    logEvent({ kind: "research_done", prospectId });

    return NextResponse.json({ research: saved });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
