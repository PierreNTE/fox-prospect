import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { collectAndSave, pendingIntelAccounts } from "@/lib/account-intel";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Collecte web gratuite en lot, quelques comptes par appel (la page boucle).
// GET  → nombre de comptes Salesforce actifs encore sans collecte.
// POST → collecte les 3 suivants ; renvoie { results, remaining }.
const PER_CALL = 3;

async function countPending(supabase) {
  const { count } = await supabase
    .from("accounts").select("id", { count: "exact", head: true })
    .eq("source", "salesforce").in("health_status", ["active", "vigilance"]).is("web_intel_at", null);
  return count || 0;
}

export async function GET() {
  return NextResponse.json({ remaining: await countPending(getSupabase()) });
}

export async function POST() {
  const supabase = getSupabase();
  const accounts = await pendingIntelAccounts(supabase, { limit: PER_CALL, days: 30 });
  const results = [];
  for (const a of accounts) {
    try {
      const intel = await collectAndSave(supabase, a);
      results.push({ id: a.id, name: a.name, site: intel.site?.url || null, phones: intel.phones.length,
        emails: intel.emails.generic.length + intel.emails.named.length, tech: intel.tech.length });
    } catch (e) {
      // On marque quand même la tentative : sinon le compte bloquerait la file.
      await supabase.from("accounts").update({
        web_intel: { collected_at: new Date().toISOString(), error: e.message }, web_intel_at: new Date().toISOString(),
      }).eq("id", a.id);
      results.push({ id: a.id, name: a.name, error: e.message });
    }
  }
  return NextResponse.json({ results, remaining: await countPending(supabase) });
}
