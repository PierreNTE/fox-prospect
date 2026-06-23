import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { computePriorities } from "@/lib/data";

export const dynamic = "force-dynamic";

// Rafraîchissement client des priorités (le 1er rendu vient du serveur via lib/data).
// Top 10 prospects actifs triés par NBA — aucun appel LLM.
export async function GET() {
  return NextResponse.json({ priorities: await computePriorities(getSupabase()) });
}
