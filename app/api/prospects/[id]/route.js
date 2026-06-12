import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const supabase = getSupabase();
  const { id } = params;

  const [{ data: prospect, error }, { data: research }, { data: drafts }] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", id).single(),
    supabase
      .from("research")
      .select("*")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("drafts")
      .select("*")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  return NextResponse.json({
    prospect,
    research: research?.[0] || null,
    drafts: drafts?.[0] || null,
  });
}

export async function PATCH(request, { params }) {
  const supabase = getSupabase();
  const { id } = params;
  const body = await request.json();

  const allowed = ["first_name", "last_name", "role", "company", "company_website", "linkedin_url", "email", "phone", "status", "notes"];
  const update = {};
  for (const key of allowed) if (key in body) update[key] = body[key];

  // Passage en opt-out : on inscrit l'email dans la liste d'opposition permanente.
  if (update.status === "opt-out") {
    const { data: p } = await supabase.from("prospects").select("email").eq("id", id).single();
    const email = update.email || p?.email;
    if (!email) {
      return NextResponse.json(
        { error: "Renseigne d'abord l'email du contact : l'opposition est enregistrée par email." },
        { status: 400 }
      );
    }
    await supabase.from("optout").upsert({ email: email.toLowerCase(), reason: "demande du contact" });
  }

  const { data, error } = await supabase.from("prospects").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prospect: data });
}

export async function DELETE(_request, { params }) {
  const supabase = getSupabase();
  const { error } = await supabase.from("prospects").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
