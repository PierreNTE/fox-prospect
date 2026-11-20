import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { recheckAccount } from "@/lib/leads-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Revérifie SIRENE + BODACC pour un compte (gratuit, aucun appel IA).
export async function POST(_request, { params }) {
  const supabase = getSupabase();
  const { data: account, error } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("id", params.id)
    .single();
  if (error || !account) return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  try {
    const fields = await recheckAccount(supabase, account);
    return NextResponse.json({ health: fields });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
