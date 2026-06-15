import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/scrape/jobs — liste des jobs récents (pour le polling de l'UI).
export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("scrape_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data || [] });
}
