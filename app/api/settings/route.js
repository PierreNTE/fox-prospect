import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("settings").select("*").eq("id", 1).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}

export async function PUT(request) {
  const supabase = getSupabase();
  const body = await request.json();

  const { data, error } = await supabase
    .from("settings")
    .update({
      offer: body.offer ?? "",
      sender_name: body.sender_name ?? "",
      sender_role: body.sender_role ?? "",
      sender_company: body.sender_company ?? "",
      icp: body.icp ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
