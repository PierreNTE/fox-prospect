import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Vues sauvegardées du tableau de bord (Sprint 3).
// GET → liste ; POST { name, filters } → crée ; DELETE ?id= → supprime.

export async function GET() {
  const { data } = await getSupabase()
    .from("saved_views")
    .select("*")
    .order("created_at", { ascending: true });
  return NextResponse.json({ views: data || [] });
}

export async function POST(request) {
  const { name, filters } = await request.json().catch(() => ({}));
  const cleanName = String(name || "").trim().slice(0, 60);
  if (!cleanName) return NextResponse.json({ error: "Nom de vue requis." }, { status: 400 });

  const { data, error } = await getSupabase()
    .from("saved_views")
    .insert({ name: cleanName, filters: filters || {} })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ view: data });
}

export async function DELETE(request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis." }, { status: 400 });
  const { error } = await getSupabase().from("saved_views").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
