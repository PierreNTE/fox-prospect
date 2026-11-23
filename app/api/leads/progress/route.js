import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { leadsProgress } from "@/lib/leads-pipeline";

export const dynamic = "force-dynamic";

// GET /api/leads/progress — avancement de la recherche sur les leads.
export async function GET() {
  return NextResponse.json(await leadsProgress(getSupabase()));
}
