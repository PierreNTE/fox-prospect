import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { checkMonthlyBudget, budgetMessage } from "@/lib/budget";
import { logAiRun } from "@/lib/ai-runs";
import { MODEL_HAIKU } from "@/lib/constants";
import { jobCheckSystemPrompt, jobCheckUserPrompt } from "@/lib/prompts-ia";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUTS = ["en_poste", "change_de_poste", "parti", "incertain"];

// IA4 — suivi des décideurs. Contrôle MANUEL, un contact à la fois (pas de
// balayage automatique : le web_search coûte, et une fausse alerte coûte plus cher
// encore). Le résultat est consigné sur le contact.
export async function POST(_request, { params }) {
  const supabase = getSupabase();
  const { id } = params;

  const { data: contact } = await supabase.from("account_contacts").select("*").eq("id", id).single();
  if (!contact) return NextResponse.json({ error: "Contact introuvable." }, { status: 404 });

  const budget = await checkMonthlyBudget(supabase);
  if (budget.exceeded) {
    return NextResponse.json(
      { error: budgetMessage(budget) },
      { status: 429 }
    );
  }

  const { data: account } = await supabase.from("accounts").select("name").eq("id", contact.account_id).single();

  const { json, usage, webSearchCount } = await callClaudeJson({
    system: jobCheckSystemPrompt(),
    user: jobCheckUserPrompt({ contact, accountName: account?.name || "" }),
    maxTokens: 900,
    webSearch: true,
    maxSearches: Number(process.env.RESEARCH_MAX_SEARCHES) || 2,
    model: MODEL_HAIKU,
  });

  const statut = STATUTS.includes(json?.statut) ? json.statut : "incertain";
  const note = [
    json?.detail,
    json?.action_suggeree ? `→ ${json.action_suggeree}` : "",
    json?.source ? `(${json.source})` : "",
  ].filter(Boolean).join(" ").slice(0, 500);

  await supabase
    .from("account_contacts")
    .update({ job_check_status: statut, job_check_note: note, job_checked_at: new Date().toISOString() })
    .eq("id", id);

  logAiRun({ route: "job_check", accountId: contact.account_id, usage, webSearchCount, model: MODEL_HAIKU });

  return NextResponse.json({ statut, note, result: json });
}
