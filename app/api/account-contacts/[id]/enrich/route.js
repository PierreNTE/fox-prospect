import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { enrichAccountContact } from "@/lib/enrich-contact";
import { checkMonthlyBudget } from "@/lib/budget";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // recherche web (Fluid Compute)

// Enrichissement manuel des coordonnées d'un contact d'organigramme (bouton
// « Enrichir » de la fiche compte). Même cœur que l'enrichissement automatique
// en veille (lib/enrich-contact).
export async function POST(_request, { params }) {
  const supabase = getSupabase();

  // Kill-switch budget mensuel : coupe net si la dépense Anthropic du mois a
  // atteint MONTHLY_BUDGET_EUR (reprise automatique au 1er du mois suivant).
  const { exceeded, spent, budget } = await checkMonthlyBudget(supabase);
  if (exceeded) {
    return NextResponse.json(
      { error: `Budget mensuel atteint (${spent.toFixed(2)} € / ${budget} €). Reprise le 1er du mois prochain, ou augmente MONTHLY_BUDGET_EUR.` },
      { status: 429 }
    );
  }

  try {
    const result = await enrichAccountContact(supabase, params.id);
    return NextResponse.json(result);
  } catch (e) {
    const status = e.message === "Contact introuvable." ? 404 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
}
