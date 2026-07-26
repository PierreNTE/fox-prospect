import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getCalendar } from "@/lib/calendar";

export const dynamic = "force-dynamic";

// Agenda Outlook (flux ICS publié) rapproché des comptes du CRM.
// Lecture seule, aucun coût IA. `?refresh=1` court-circuite le cache mémoire ;
// `?days=` borne la fenêtre (30 jours max, au-delà l'agenda n'aide plus).
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(30, Math.max(1, Number(searchParams.get("days")) || 14));
  const force = searchParams.get("refresh") === "1";

  // getCalendar ne lève jamais : un agenda injoignable renvoie { error } et
  // l'interface continue de fonctionner avec les tâches et les relances.
  const result = await getCalendar(getSupabase(), { days, force });
  return NextResponse.json(result);
}
