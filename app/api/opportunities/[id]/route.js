import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { OPP_STAGES, OPP_STAGE_PROBABILITY } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const supabase = getSupabase();
  const { id } = params;
  const body = await request.json();

  const update = { updated_at: new Date().toISOString() };
  if ("title" in body) update.title = (body.title || "").trim();
  if ("stage" in body && OPP_STAGES.includes(body.stage)) {
    update.stage = body.stage;
    // Aligne la probabilité sur l'étape, sauf si l'utilisateur la fixe dans le même geste.
    if (!("probability" in body)) update.probability = OPP_STAGE_PROBABILITY[body.stage];
  }
  if ("amount_eur" in body) update.amount_eur = body.amount_eur === "" || body.amount_eur == null ? null : Number(body.amount_eur);
  if ("probability" in body) update.probability = body.probability === "" || body.probability == null ? null : Number(body.probability);
  if ("expected_close_date" in body) update.expected_close_date = body.expected_close_date || null;
  if ("notes" in body) update.notes = (body.notes || "").trim();

  const { data, error } = await supabase
    .from("opportunities")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ opportunity: data });
}

export async function DELETE(_request, { params }) {
  const supabase = getSupabase();
  const { error } = await supabase.from("opportunities").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
