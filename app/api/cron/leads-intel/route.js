import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { collectAndSave, pendingIntelAccounts } from "@/lib/account-intel";
import { recheckAccount } from "@/lib/leads-import";
import { runLeadsAgent } from "@/lib/leads-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Travail gratuit (sans IA) sur les leads Salesforce, sans page ouverte.
// Appelé par le worker GitHub Actions toutes les 2 h (protégé par CRON_SECRET) :
//   1. collecte d'infos publiques des comptes pas encore collectés ;
//   2. recherche du successeur pour les radiées / introuvables jamais revérifiées
//      depuis la mise en service de cette recherche ;
//   3. agent : mise en file des fiches IA (si crédit) et des recherches de
//      décideurs IT (worker de scraping).
// ?dry=1 : ne fait que compter (diagnostic).
const SUCCESSOR_SINCE = "2026-11-20T08:30:00Z"; // mise en service de la recherche de successeur

function authorized(request) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return true;
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return token === secret;
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const supabase = getSupabase();
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const started = Date.now();
  const budgetMs = 230_000;
  const out = { intel: [], successor: [], agent: null };

  const pending = await pendingIntelAccounts(supabase, { limit: Number(process.env.INTEL_PER_RUN) || 10 });
  const { data: toRecheck } = await supabase
    .from("accounts").select("id, name")
    .eq("source", "salesforce").in("health_status", ["fermee", "introuvable"])
    .lt("health_checked_at", SUCCESSOR_SINCE).limit(Number(process.env.SUCCESSOR_PER_RUN) || 8);

  if (dry) {
    return NextResponse.json({ dry: true, intel_pending: pending.map((a) => a.name), successor_pending: (toRecheck || []).map((a) => a.name) });
  }

  for (const a of pending) {
    if (Date.now() - started > budgetMs * 0.6) break;
    try {
      const i = await collectAndSave(supabase, a);
      out.intel.push({ name: a.name, site: i.site?.url || null, match: i.site?.match || null, phones: i.phones.length,
        emails: i.emails.generic.length + i.emails.named.length, linkedin: !!i.socials?.linkedin,
        mail: i.dns?.mail_provider || null, tech: i.tech.map((t) => t.label), contracts: i.public_contracts?.length ?? null,
        contracts_error: i.public_contracts_error || null, ms: i.duration_ms });
    } catch (e) {
      out.intel.push({ name: a.name, error: e.message });
    }
  }

  for (const a of toRecheck || []) {
    if (Date.now() - started > budgetMs * 0.9) break;
    try {
      const f = await recheckAccount(supabase, a);
      const s = f.health_detail?.successor;
      out.successor.push({ name: a.name, status: f.health_status, successor: s ? `${s.name} (${s.reason_label}, ${s.confidence})` : null });
    } catch (e) {
      out.successor.push({ name: a.name, error: e.message });
    }
  }

  try {
    const r = await runLeadsAgent(supabase);
    out.agent = { call_prep_queued: r.queued, scrape_queued: r.scrape?.queued ?? 0, scrape_error: r.scrape?.error || null };
  } catch (e) {
    out.agent = { error: e.message };
  }

  out.duration_ms = Date.now() - started;
  return NextResponse.json(out);
}
