import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { ingestBoampSignals } from "@/lib/collect-boamp";
import { ingestFranceTravailSignals } from "@/lib/collect-france-travail";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cron de collecte des signaux d'achat depuis les APIs publiques gratuites.
// - BOAMP/TED : marchés publics IT (CPV 48xxx/72xxx) — sans clé
// - France Travail : offres RSSI/DSI/cloud — OAuth2 (FRANCE_TRAVAIL_CLIENT_ID requis)
// Déclenché quotidiennement (voir vercel.json), indépendamment du cron d'analyse LLM.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  const results = {};

  // ── BOAMP ──────────────────────────────────────────────────────────────────
  try {
    results.boamp = await ingestBoampSignals(supabase, { daysBack: 2 });
  } catch (e) {
    results.boamp = { error: e.message };
  }

  // ── France Travail ─────────────────────────────────────────────────────────
  try {
    results.france_travail = await ingestFranceTravailSignals(supabase);
  } catch (e) {
    results.france_travail = { error: e.message };
  }

  const total = (results.boamp?.inserted ?? 0) + (results.france_travail?.inserted ?? 0);
  return NextResponse.json({ ok: true, signals_inserted: total, details: results });
}
