import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { collectAndSave } from "@/lib/account-intel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/accounts/[id]/intel — collecte web gratuite (sans IA) pour un compte.
export async function POST(_request, { params }) {
  const supabase = getSupabase();
  const { data: account, error } = await supabase
    .from("accounts").select("id, name, website, domain, health_status, health_detail, call_prep").eq("id", params.id).single();
  if (error || !account) return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  try {
    return NextResponse.json({ intel: await collectAndSave(supabase, account) });
  } catch (e) {
    console.error(`[intel] ${account.name} : ${e.message}`);
    return NextResponse.json({ error: `Collecte impossible : ${e.message}` }, { status: 502 });
  }
}
