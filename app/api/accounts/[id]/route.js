import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getAccountDetail } from "@/lib/data";

export const dynamic = "force-dynamic";

// Rafraîchissement client de la fiche (le 1er rendu vient du serveur via lib/data).
export async function GET(_request, { params }) {
  const result = await getAccountDetail(getSupabase(), params.id);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
}

export async function PATCH(request, { params }) {
  const supabase = getSupabase();
  const { id } = params;
  const body = await request.json();

  const allowed = ["name", "website", "domain", "sector", "hq", "summary", "auto_watch"];
  const update = {};
  for (const key of allowed) if (key in body) update[key] = body[key];

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
