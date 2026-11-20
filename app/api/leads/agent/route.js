import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { runLeadsAgent, leadsAgentStatus } from "@/lib/leads-agent";

export const dynamic = "force-dynamic";

// GET  /api/leads/agent → état de l'agent sur 7 jours.
// POST /api/leads/agent → met en file les fiches d'approche des meilleurs comptes
//                         (appelé automatiquement à la fin d'un import).
export async function GET() {
  return NextResponse.json(await leadsAgentStatus(getSupabase()));
}

export async function POST() {
  const supabase = getSupabase();
  try {
    const result = await runLeadsAgent(supabase);
    return NextResponse.json({ ...result, status: await leadsAgentStatus(supabase) });
  } catch (e) {
    console.error(`[leads-agent] ${e.message}`);
    return NextResponse.json({ error: `Agent : ${e.message}` }, { status: 500 });
  }
}
