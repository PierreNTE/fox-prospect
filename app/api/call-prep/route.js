import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { checkMonthlyBudget, budgetMessage } from "@/lib/budget";
import { logAiRun } from "@/lib/ai-runs";
import { getEnvConfig, MODEL_SONNET } from "@/lib/constants";
import { callPrepSystemPrompt, callPrepUserPrompt, normalizeCallPrep } from "@/lib/prompts-call-prep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/call-prep { accountId, force? }
// Préparation d'un appel à froid : actu, interlocuteur cible, passage du
// standard, questions de qualification infra. Sonnet + recherche web →
// déclenché à la main, mis en cache sur le compte, sous le kill-switch budget.
export async function POST(request) {
  const supabase = getSupabase();
  const { accountId, force = false } = await request.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ error: "accountId requis." }, { status: 400 });

  const { data: account, error } = await supabase.from("accounts").select("*").eq("id", accountId).single();
  if (error || !account) return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });

  if (!force && account.call_prep) {
    return NextResponse.json({ prep: account.call_prep, cached: true, generated_at: account.call_prep_at });
  }

  const budget = await checkMonthlyBudget(supabase);
  if (budget.exceeded) return NextResponse.json({ error: budgetMessage(budget) }, { status: 429 });

  const { maxSearches } = getEnvConfig();
  const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();

  try {
    const { json, usage, webSearchCount } = await callClaudeJson({
      system: callPrepSystemPrompt(),
      user: callPrepUserPrompt({
        account,
        health: account.health_detail,
        qualif: account.dell_qualif,
        sender: settings,
      }),
      maxTokens: 3500,
      webSearch: true,
      maxSearches,
      model: MODEL_SONNET,
    });
    const prep = normalizeCallPrep(json);
    const now = new Date().toISOString();
    await supabase.from("accounts").update({ call_prep: prep, call_prep_at: now }).eq("id", accountId);
    await logAiRun({ route: "call_prep", accountId, usage, webSearchCount, model: MODEL_SONNET });
    return NextResponse.json({ prep, cached: false, generated_at: now });
  } catch (e) {
    if (e.usage) await logAiRun({ route: "call_prep", accountId, usage: e.usage, webSearchCount: e.webSearchCount || 0, model: MODEL_SONNET });
    return NextResponse.json({ error: `Préparation impossible : ${e.message}` }, { status: 502 });
  }
}
