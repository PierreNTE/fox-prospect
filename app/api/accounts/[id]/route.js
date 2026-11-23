import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getAccountDetail, getAccountSignals } from "@/lib/data";

export const dynamic = "force-dynamic";

// Rafraîchissement client de la fiche (le 1er rendu vient du serveur via lib/data).
// Doit renvoyer EXACTEMENT la même forme que le rendu serveur, signaux compris :
// sinon la carte de veille disparaît dès la première mutation de la fiche.
export async function GET(_request, { params }) {
  const supabase = getSupabase();
  const [result, signals] = await Promise.all([
    getAccountDetail(supabase, params.id),
    getAccountSignals(supabase, params.id),
  ]);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ...result, signals });
}

export async function PATCH(request, { params }) {
  const supabase = getSupabase();
  const { id } = params;
  const body = await request.json();

  const allowed = ["name", "website", "domain", "sector", "hq", "summary", "auto_watch", "call_status", "call_note", "recall_at"];
  const update = {};
  for (const key of allowed) if (key in body) update[key] = body[key] === "" && key === "recall_at" ? null : body[key];
  if ("call_status" in update || "call_note" in update || "recall_at" in update) update.call_updated_at = new Date().toISOString();

  const { data, error } = await supabase.from("accounts").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data });
}

export async function DELETE(_request, { params }) {
  const supabase = getSupabase();
  const { error } = await supabase.from("accounts").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
