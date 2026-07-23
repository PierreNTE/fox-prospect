import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { OPP_STAGES, OPP_STAGE_PROBABILITY } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .order("expected_close_date", { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ opportunities: data || [] });
}

export async function POST(request) {
  const supabase = getSupabase();
  const body = await request.json();
  if (!body.account_id) return NextResponse.json({ error: "account_id requis." }, { status: 400 });
  const title = (body.title || "").trim();
  if (!title) return NextResponse.json({ error: "Un intitulé est requis." }, { status: 400 });
  const stage = OPP_STAGES.includes(body.stage) ? body.stage : "qualification";

  const { data, error } = await supabase
    .from("opportunities")
    .insert({
      account_id: body.account_id,
      prospect_id: body.prospect_id || null,
      title,
      stage,
      amount_eur: body.amount_eur != null && body.amount_eur !== "" ? Number(body.amount_eur) : null,
      probability: body.probability != null && body.probability !== "" ? Number(body.probability) : OPP_STAGE_PROBABILITY[stage],
      expected_close_date: body.expected_close_date || null,
      notes: (body.notes || "").trim(),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ opportunity: data });
}
