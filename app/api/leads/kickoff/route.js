import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { runLeadsAgent } from "@/lib/leads-agent";
import { listSalesforceLeads } from "@/lib/leads-import";
import { runLeadsHousekeeping, dispatchWorkers } from "@/lib/leads-pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/leads/kickoff — appelé à la fin de l'import : doublons fusionnés,
// recherches mises en file (site officiel, décideurs IT) et workers GitHub
// lancés tout de suite. La collecte web, elle, part depuis la page (et le cron).
export async function POST() {
  const supabase = getSupabase();
  const leads = await listSalesforceLeads(supabase);
  const { data: raw } = await supabase.from("accounts").select("id, name, sf_lead_status, sf_first_seen_at, created_at, health_detail").eq("source", "salesforce").limit(3000);
  const house = await runLeadsHousekeeping(supabase, raw || []);
  const agent = await runLeadsAgent(supabase).catch((e) => ({ error: e.message }));
  const dispatch = await dispatchWorkers("leads");
  return NextResponse.json({ leads: leads.length, ...house, agent, dispatch });
}
