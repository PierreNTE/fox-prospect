import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/scrape/jobs/[id] — un job + ses résultats (polling temps réel de l'UI).
export async function GET(_request, { params }) {
  const supabase = getSupabase();
  const { id } = params;

  const [{ data: job, error }, { data: results }] = await Promise.all([
    supabase.from("scrape_jobs").select("*").eq("id", id).single(),
    supabase
      .from("scrape_results")
      .select("*")
      .eq("job_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ job, results: results || [] });
}
