import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const supabase = getSupabase();
  const { id } = params;

  const [{ data: account, error }, { data: contacts }, { data: prospects }] = await Promise.all([
    supabase.from("accounts").select("*").eq("id", id).single(),
    supabase
      .from("account_contacts")
      .select("*")
      .eq("account_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("prospects").select("id, first_name, last_name, role, fit_score, status").eq("account_id", id),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  return NextResponse.json({
    account,
    contacts: contacts || [],
    prospects: prospects || [],
  });
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
