// Session d'appels : un lead à la fois, résultat en un clic, puis le suivant.
import { getSupabase } from "@/lib/supabase";
import { listSalesforceLeads } from "@/lib/leads-import";
import SessionClient from "./SessionClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const leads = await listSalesforceLeads(getSupabase());
  return <SessionClient initialLeads={leads} />;
}
