import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { drainJobQueue } from "@/lib/process-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Worker de la file de jobs — dépile la table `jobs` sans onglet navigateur ouvert.
// Protégé par CRON_SECRET. La logique vit dans lib/process-jobs.js et est aussi
// appelée en fin de /api/cron/refresh-accounts (Vercel Hobby = 2 crons max, donc
// pas de cron dédié — la file se vide en queue du cron de veille). Cette route
// reste pour l'invocation manuelle (dashboard Vercel → Invoke, ou test local).
export async function GET(request) {
  // Tolérant aux espaces/retours à la ligne parasites (copier-coller du secret).
  const secret = (process.env.CRON_SECRET || "").trim();
  if (secret) {
    const auth = (request.headers.get("authorization") || "").trim();
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token !== secret) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  const result = await drainJobQueue(supabase);
  return NextResponse.json(result);
}
