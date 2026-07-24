// Composant SERVEUR : charge l'agenda (tâches + relances + RDV Outlook) côté
// serveur et le passe en props au client. Même pattern SSR que les autres listes.
import { getSupabase } from "@/lib/supabase";
import { getAgenda } from "@/lib/data";
import { getCalendar } from "@/lib/calendar";
import AgendaClient from "./AgendaClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const supabase = getSupabase();
  // getCalendar avale ses erreurs (flux injoignable, non configuré) : le rendu
  // ne doit jamais dépendre de la disponibilité d'un service externe.
  const [initial, calendar] = await Promise.all([getAgenda(supabase), getCalendar(supabase)]);
  return <AgendaClient initial={initial} calendar={calendar} />;
}
