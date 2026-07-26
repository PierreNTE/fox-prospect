import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const KINDS = new Set(["appel", "email", "linkedin", "rdv", "relance", "autre"]);

// Liste complète de l'agenda (ouvertes + terminées) — le client groupe et filtre.
// Volume solo faible : une seule requête bornée suffit.
export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data || [] });
}

export async function POST(request) {
  const supabase = getSupabase();
  const body = await request.json();
  const title = (body.title || "").trim();
  if (!title) return NextResponse.json({ error: "Un intitulé est requis." }, { status: 400 });

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      kind: KINDS.has(body.kind) ? body.kind : "autre",
      due_date: body.due_date || null,
      prospect_id: body.prospect_id || null,
      account_id: body.account_id || null,
      notes: (body.notes || "").trim(),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}
