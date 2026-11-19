// Leads Salesforce : import du PDF « Printable View » + contrôle de santé.
import { getSupabase } from "@/lib/supabase";
import { listSalesforceLeads } from "@/lib/leads-import";
import LeadsClient from "./LeadsClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const leads = await listSalesforceLeads(getSupabase());
  return <LeadsClient initialLeads={leads} />;
}
