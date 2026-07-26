// Composant SERVEUR : la veille se lit, elle ne se saisit pas. Tout le contenu
// part donc du serveur, et le client ne porte que le filtrage.
import { getSupabase } from "@/lib/supabase";
import { getVeilleOverview } from "@/lib/data";
import VeilleClient from "./VeilleClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await getVeilleOverview(getSupabase());
  return <VeilleClient initialData={data} />;
}
