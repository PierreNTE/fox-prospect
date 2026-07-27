import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { checkMonthlyBudget } from "@/lib/budget";

export const dynamic = "force-dynamic";

// Jauge budget légère pour l'UI (une seule requête Supabase). /api/health fait
// un vrai ping Anthropic/Brave à chaque appel : trop lourd pour être appelé
// depuis chaque fiche.
export async function GET() {
  const { exceeded, reason, spent, budget, allowance, dayOfMonth, daysInMonth } =
    await checkMonthlyBudget(getSupabase());
  return NextResponse.json({
    exceeded,
    // « mois » impose d'attendre le 1er, « rythme » se rouvre demain : la jauge
    // doit dire laquelle des deux, sinon elle pousse à relever le plafond.
    reason,
    spent_eur: Math.round(spent * 100) / 100,
    budget_eur: budget,
    allowance_eur: Math.round(allowance * 100) / 100,
    day_of_month: dayOfMonth,
    days_in_month: daysInMonth,
  });
}
