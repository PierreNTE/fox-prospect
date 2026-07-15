import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { enrichAccountContact } from "@/lib/enrich-contact";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // recherche web (Fluid Compute)

// Enrichissement manuel des coordonnées d'un contact d'organigramme (bouton
// « Enrichir » de la fiche compte). Même cœur que l'enrichissement automatique
// en veille (lib/enrich-contact).
export async function POST(_request, { params }) {
  try {
    const result = await enrichAccountContact(getSupabase(), params.id);
    return NextResponse.json(result);
  } catch (e) {
    const status = e.message === "Contact introuvable." ? 404 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
