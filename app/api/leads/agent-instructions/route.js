import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { buildAgentInstructions, buildTrackingInstructions } from "@/lib/sales-chat";

export const dynamic = "force-dynamic";

// GET /api/leads/agent-instructions — instructions de l'agent Sales Chat,
// signées avec le nom et le poste des réglages.
// ?type=suivi — instructions de l'agent « suivi des envois » (lecture seule).
export async function GET(request) {
  const type = new URL(request.url).searchParams.get("type");
  const { data } = await getSupabase().from("settings").select("sender_name, sender_role, sender_phone").eq("id", 1).maybeSingle();
  if (type === "suivi") {
    return NextResponse.json({ instructions: buildTrackingInstructions({ senderName: data?.sender_name }) });
  }
  return NextResponse.json({ instructions: buildAgentInstructions({ senderName: data?.sender_name, senderRole: data?.sender_role, senderPhone: data?.sender_phone }) });
}
