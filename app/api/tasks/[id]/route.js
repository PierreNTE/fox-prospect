import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const KINDS = new Set(["appel", "email", "linkedin", "rdv", "relance", "autre"]);

export async function PATCH(request, { params }) {
  const supabase = getSupabase();
  const { id } = params;
  const body = await request.json();

  const update = { updated_at: new Date().toISOString() };
  if ("title" in body) update.title = (body.title || "").trim();
  if ("kind" in body && KINDS.has(body.kind)) update.kind = body.kind;
  if ("due_date" in body) update.due_date = body.due_date || null;
  if ("notes" in body) update.notes = (body.notes || "").trim();
  // Cocher / décocher : horodate done_at pour tracer la complétion.
  if ("done" in body) {
    update.done = !!body.done;
    update.done_at = body.done ? new Date().toISOString() : null;
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function DELETE(_request, { params }) {
  const supabase = getSupabase();
  const { error } = await supabase.from("tasks").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
