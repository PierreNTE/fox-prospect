import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const supabase = getSupabase();
  const { id } = params;
  const body = await request.json();

  const allowed = [
    "first_name", "last_name", "role", "department", "level", "responsibilities",
    "email", "phone", "linkedin_url",
    "reliability", "role_confidence", "data_date",
    "source", "manager_id", "validated",
  ];
  const update = { updated_at: new Date().toISOString() };
  for (const key of allowed) if (key in body) update[key] = body[key];

  // Empêche une personne d'être son propre responsable.
  if (update.manager_id === id) update.manager_id = null;

  const { data, error } = await supabase
    .from("account_contacts")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}

export async function DELETE(_request, { params }) {
  const supabase = getSupabase();
  const { error } = await supabase.from("account_contacts").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
