import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { checkMonthlyBudget, budgetMessage } from "@/lib/budget";
import { logAiRun } from "@/lib/ai-runs";
import { getAccountDetail } from "@/lib/data";
import { rdvBriefSystemPrompt, rdvBriefUserPrompt } from "@/lib/prompts-ia";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// IA1 — préparation de RDV. Synthétise les données CRM du compte (actus, orga,
// échanges, affaires) en un briefing. PAS de recherche web : tout est déjà en
// base → coût minimal. Mis en cache sur le compte, régénéré seulement sur `force`.
export async function POST(request) {
  const supabase = getSupabase();
  const { accountId, force } = await request.json();
  if (!accountId) return NextResponse.json({ error: "accountId requis." }, { status: 400 });

  const detail = await getAccountDetail(supabase, accountId);
  if (detail.error) return NextResponse.json({ error: detail.error }, { status: 404 });
  const { account, contacts, events, opportunities } = detail;

  if (!force && account.rdv_brief) {
    return NextResponse.json({ brief: account.rdv_brief, cached: true, generated_at: account.rdv_brief_at });
  }

  const budget = await checkMonthlyBudget(supabase);
  if (budget.exceeded) {
    return NextResponse.json(
      { error: budgetMessage(budget) },
      { status: 429 }
    );
  }

  const { json, usage } = await callClaudeJson({
    system: rdvBriefSystemPrompt(),
    user: rdvBriefUserPrompt({ account, contacts, events, opportunities }),
    maxTokens: 2000,
    webSearch: false,
  });

  const brief = {
    contexte: String(json?.contexte || ""),
    actus_cles: Array.isArray(json?.actus_cles) ? json.actus_cles.slice(0, 4) : [],
    interlocuteurs: Array.isArray(json?.interlocuteurs) ? json.interlocuteurs.slice(0, 4) : [],
    ou_on_en_est: String(json?.ou_on_en_est || ""),
    questions: Array.isArray(json?.questions) ? json.questions.slice(0, 5) : [],
    risques: Array.isArray(json?.risques) ? json.risques.slice(0, 3) : [],
    objectif_suggere: String(json?.objectif_suggere || ""),
  };

  const now = new Date().toISOString();
  await supabase.from("accounts").update({ rdv_brief: brief, rdv_brief_at: now }).eq("id", accountId);
  await logAiRun({ route: "rdv_brief", accountId, usage, webSearchCount: 0 });

  return NextResponse.json({ brief, cached: false, generated_at: now });
}
