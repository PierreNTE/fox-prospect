import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { importLead } from "@/lib/leads-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Import par lots : la page envoie les sociétés 6 par 6 pour rester sous la
// durée maximale d'une fonction Vercel (2 appels API publics par société) et
// sous la limite de débit de l'API Recherche d'entreprises.
const MAX_BATCH = 6;

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const leads = Array.isArray(body.leads) ? body.leads.slice(0, MAX_BATCH) : [];
  if (!leads.length) return NextResponse.json({ error: "Aucun lead fourni." }, { status: 400 });

  const supabase = getSupabase();
  const results = [];
  for (const lead of leads) {
    results.push(await importLead(supabase, lead));
    // ~7 requêtes/s tolérées par l'API publique : on reste large.
    await new Promise((r) => setTimeout(r, 350));
  }
  return NextResponse.json({ results });
}
