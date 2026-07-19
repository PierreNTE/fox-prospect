import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { checkMonthlyBudget } from "@/lib/budget";

export const dynamic = "force-dynamic";

// Jauge budget légère pour l'UI (une seule requête Supabase). /api/health fait
// un vrai ping Anthropic/Brave à chaque appel : trop lourd pour être appelé
// depuis chaque fiche.
export async function GET() {
  const { exceeded, spent, budget } = await checkMonthlyBudget(getSupabase());
  return NextResponse.json({
    exceeded,
    spent_eur: Math.round(spent * 100) / 100,
    budget_eur: budget,
  });
}
