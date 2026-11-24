import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { listSalesforceLeads } from "@/lib/leads-import";
import { parseAgentRecap, planRecapUpdates } from "@/lib/agent-recap";

export const dynamic = "force-dynamic";

// POST /api/leads/agent-recap { text } — récapitulatif collé depuis l'agent
// Sales Chat : leads traités (ne repartent pas avant 25 jours), emails trouvés,
// rebonds (adresse écartée), STOP (plus jamais d'email).
export async function POST(request) {
  const { text } = await request.json().catch(() => ({}));
  if (!String(text || "").trim()) return NextResponse.json({ error: "Colle le récapitulatif de l'agent." }, { status: 400 });
  const supabase = getSupabase();
  const recap = parseAgentRecap(text);
  const leads = await listSalesforceLeads(supabase);
  const { updates, unmatched } = planRecapUpdates(recap, leads);
  let saved = 0;
  for (const { id, ...patch } of updates) {
    const { error } = await supabase.from("accounts").update(patch).eq("id", id);
    if (!error) saved++;
  }
  return NextResponse.json({
    lus: { lignes: recap.rows.length, emails: recap.found.length, rebonds: recap.bounces.length, stop: recap.stops.length },
    mis_a_jour: saved,
    traites: updates.filter((u) => u.email_exported_at).length,
    emails_enregistres: updates.filter((u) => u.found_email).length,
    rebonds: updates.filter((u) => u.bounced_emails).length,
    stop: updates.filter((u) => u.email_opt_out).length,
    non_trouves: unmatched,
  });
}
