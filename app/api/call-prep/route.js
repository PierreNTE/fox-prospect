import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { runCallPrep, BudgetError } from "@/lib/call-prep";
import { explainAiError } from "@/lib/prompts-call-prep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/call-prep { accountId, force? }
// Fiche d'approche : coordonnées publiques, interlocuteurs IT (ajoutés à
// l'organigramme du compte), actu, messages email / LinkedIn / relance.
// Sonnet + recherche web, mis en cache sur le compte, sous le kill-switch budget.
// Le cœur est dans lib/call-prep.js (partagé avec l'agent hebdomadaire).
export async function POST(request) {
  const supabase = getSupabase();
  const { accountId, force = false } = await request.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ error: "accountId requis." }, { status: 400 });

  const { data: account, error } = await supabase.from("accounts").select("*").eq("id", accountId).single();
  if (error || !account) return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });

  try {
    return NextResponse.json(await runCallPrep(supabase, account, { force }));
  } catch (e) {
    if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
    console.error(`[call-prep] ${account.name} : ${e.message}`);
    return NextResponse.json({ error: `Préparation impossible : ${explainAiError(e.message)}` }, { status: 502 });
  }
}
