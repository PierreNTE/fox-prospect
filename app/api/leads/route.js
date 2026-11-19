import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { listSalesforceLeads } from "@/lib/leads-import";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ leads: await listSalesforceLeads(getSupabase()) });
}
