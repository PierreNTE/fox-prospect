import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { collectAndSave, pendingIntelAccounts } from "@/lib/account-intel";
import { recheckAccount } from "@/lib/leads-import";
import { runLeadsAgent } from "@/lib/leads-agent";
import { aiEnabled } from "@/lib/constants";
import { saveFreeCallPrep } from "@/lib/call-prep";
import { drainFreeJobs } from "@/lib/process-jobs";
import { wikidataWebsite } from "@/lib/account-intel";
import { fetchBodaccFull, searchBodaccText, lookupSiren } from "@/lib/company-health";
import { recordText, linkReason, extractSirens, successorCandidates, successorNames } from "@/lib/company-successor";
import { dnsIntel } from "@/lib/dns-intel";

// Diagnostic réseau (?debug=1) : sondes sur des données publiques connues, et
// pour les comptes radiés uniquement des COMPTEURS anonymes (journaux publics).
async function diagnostics(supabase) {
  const t = async (fn) => { const s = Date.now(); try { const r = await fn(); return { ok: true, ms: Date.now() - s, ...r }; } catch (e) { return { ok: false, ms: Date.now() - s, error: e.message.slice(0, 160) }; } };
  const probes = {
    wikidata: await t(async () => ({ site: await wikidataWebsite("424761419") })),
    dns: await t(async () => { const d = await dnsIntel("ovhcloud.com"); return { mail: d?.mail_provider, services: d?.services?.length }; }),
    bodacc_text: await t(async () => {
      const r = await searchBodaccText("fusion-absorption");
      const withReason = r.filter((x) => linkReason(recordText(x))).length;
      return { n: r.length, withReason, keys: Object.keys(r[0] || {}).slice(0, 30), sirens: r.reduce((n, x) => n + extractSirens(recordText(x)).length, 0) };
    }),
    boamp: await t(async () => {
      const res = await fetch(`https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records?${new URLSearchParams({ where: '"Nantes" AND ("informatique")', limit: "5" })}`, { signal: AbortSignal.timeout(9000) });
      const j = await res.json().catch(() => ({}));
      return { status: res.status, n: j?.results?.length ?? null, keys: Object.keys(j?.results?.[0] || {}).slice(0, 40), err: j?.message?.slice?.(0, 160) };
    }),
  };
  const { data: closed } = await supabase
    .from("accounts").select("name, health_detail").eq("source", "salesforce")
    .in("health_status", ["fermee", "introuvable"]).limit(12);
  const successor = [];
  for (const [i, a] of (closed || []).entries()) {
    const siren = a.health_detail?.siren || a.health_detail?.predecessor?.siren || null;
    const r = await t(async () => {
      const own = siren ? await fetchBodaccFull(siren) : [];
      const byName = await searchBodaccText(a.name);
      const cands = successorCandidates(own, byName, { ownSiren: siren, oldName: a.name });
      const active = [];
      for (const c of cands.slice(0, 3)) active.push(((await lookupSiren(c.siren).catch(() => null))?.etat_administratif) || "?");
      return {
        own: own.length, own_reason: own.filter((x) => linkReason(recordText(x))).length,
        own_familles: [...new Set(own.map((x) => x.familleavis))].join(","),
        byName: byName.length, byName_reason: byName.filter((x) => linkReason(recordText(x))).length,
        candidates: cands.length, reasons: cands.map((c) => c.reason).join(","), etats: active.join(","),
        names_cited: successorNames(own).length,
      };
    });
    successor.push({ compte: i + 1, has_siren: !!siren, ...r });
  }
  return { probes, successor };
}

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
const SUCCESSOR_SINCE = "2026-11-20T10:30:00Z"; // v2 : successeur cité par son nom — tout revérifier une fois

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

  if (new URL(request.url).searchParams.get("debug") === "1") {
    return NextResponse.json(await diagnostics(supabase));
  }
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

  // Mode gratuit : fiche d'approche (sans IA) pour chaque compte actif qui n'en a pas.
  if (!aiEnabled()) {
    out.free_preps = 0;
    const { data: noPrep } = await supabase
      .from("accounts").select("*").eq("source", "salesforce")
      .in("health_status", ["active", "vigilance"]).is("call_prep", null).limit(40);
    for (const a of noPrep || []) {
      if (Date.now() - started > budgetMs) break;
      await saveFreeCallPrep(supabase, a).then(() => { out.free_preps++; }).catch(() => {});
    }
    out.free_jobs = await drainFreeJobs(supabase).catch((e) => ({ error: e.message }));
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
