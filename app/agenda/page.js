// Composant SERVEUR : charge l'agenda (tâches + relances) côté serveur et le
// passe en props au client. Même pattern SSR que les autres listes.
import { getSupabase } from "@/lib/supabase";
import { getAgenda } from "@/lib/data";
import AgendaClient from "./AgendaClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initial = await getAgenda(getSupabase());
  return <AgendaClient initial={initial} />;
}
