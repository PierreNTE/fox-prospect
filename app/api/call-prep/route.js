import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { checkMonthlyBudget, budgetMessage } from "@/lib/budget";
import { logAiRun } from "@/lib/ai-runs";
import { getEnvConfig, MODEL_SONNET } from "@/lib/constants";
import {
  callPrepSystemPrompt, callPrepUserPrompt, normalizeCallPrep, explainAiError, contactsToInsert,
} from "@/lib/prompts-call-prep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/call-prep { accountId, force? }
// Fiche d'approche : coordonnées publiques, interlocuteurs IT (ajoutés à
// l'organigramme du compte), actu, messages email / LinkedIn / relance.
// Sonnet + recherche web → déclenché à la main (ou en lot depuis /leads),
// mis en cache sur le compte, sous le kill-switch budget.
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

  // Trouver un interlocuteur ET des coordonnées demande plus de recherches
  // qu'une qualification : au moins 4 (davantage si la config le permet).
  const maxSearches = Math.max(4, getEnvConfig().maxSearches || 0);
  const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();

  try {
    const { json, usage, webSearchCount } = await callClaudeJson({
      system: callPrepSystemPrompt(),
      user: callPrepUserPrompt({
        account,
        health: account.health_detail,
        sender: settings,
      }),
      maxTokens: 4000,
      webSearch: true,
      maxSearches,
      model: MODEL_SONNET,
    });
    const prep = normalizeCallPrep(json);
    const now = new Date().toISOString();
    const accountUpdate = { call_prep: prep, call_prep_at: now };
    if (!account.website && prep.coordonnees.site) accountUpdate.website = prep.coordonnees.site;
    await supabase.from("accounts").update(accountUpdate).eq("id", accountId);

    // Interlocuteurs trouvés → organigramme du compte (enrichissables ensuite).
    const { data: existing } = await supabase
      .from("account_contacts").select("first_name, last_name").eq("account_id", accountId);
    const rows = contactsToInsert(prep, existing || [], accountId);
    let added = 0;
    if (rows.length) {
      const { data: ins, error: insErr } = await supabase.from("account_contacts").insert(rows).select("id");
      if (insErr) console.error(`[call-prep] contacts non enregistrés : ${insErr.message}`);
      added = ins?.length || 0;
    }
    await logAiRun({ route: "call_prep", accountId, usage, webSearchCount, model: MODEL_SONNET });
    return NextResponse.json({ prep, cached: false, generated_at: now, contacts_added: added });
  } catch (e) {
    if (e.usage) await logAiRun({ route: "call_prep", accountId, usage: e.usage, webSearchCount: e.webSearchCount || 0, model: MODEL_SONNET });
    console.error(`[call-prep] ${account.name} : ${e.message}`);
    return NextResponse.json({ error: `Préparation impossible : ${explainAiError(e.message)}` }, { status: 502 });
  }
}
