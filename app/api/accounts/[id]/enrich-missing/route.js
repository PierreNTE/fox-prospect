import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Enfile un job enrich_contact pour chaque contact du compte sans coordonnée
// exploitable — au lieu de l'ancienne boucle d'appels LLM pilotée par l'onglet,
// qui mourait dès que l'écran mobile se verrouillait. Les jobs sont drainés par
// /api/cron/process-jobs (cron Vercel quotidien + cron GitHub Actions), sous
// kill-switch budget. Idempotent : dédup contre les jobs pending/running
// (même règle que l'auto-enrichissement de lib/account-analyze.js).
export async function POST(_request, { params }) {
  const supabase = getSupabase();

  const { data: contacts, error } = await supabase
    .from("account_contacts")
    .select("id, email, phone, linkedin_url")
    .eq("account_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const missing = (contacts || []).filter(
    (c) => !(c.email || "").trim() && !(c.phone || "").trim() && !(c.linkedin_url || "").trim()
  );
  if (missing.length === 0) return NextResponse.json({ queued: 0, already: 0 });

  const { data: pending } = await supabase
    .from("jobs")
    .select("payload")
    .eq("kind", "enrich_contact")
    .in("status", ["pending", "running"]);
  const queuedSet = new Set((pending || []).map((j) => j.payload?.contact_id).filter(Boolean));
  const toEnqueue = missing.filter((c) => !queuedSet.has(c.id));

  if (toEnqueue.length > 0) {
    const { error: insertError } = await supabase.from("jobs").insert(
      toEnqueue.map((c) => ({ kind: "enrich_contact", payload: { contact_id: c.id }, status: "pending" }))
    );
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ queued: toEnqueue.length, already: missing.length - toEnqueue.length });
}
