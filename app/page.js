// Composant SERVEUR : récupère les données côté serveur (co-localisé avec
// Supabase) et les passe en props au composant client. Le HTML arrive déjà
// rempli → plus de cascade « charger le JS → fetch → afficher » côté navigateur.
import { getSupabase } from "@/lib/supabase";
import { listProspects } from "@/lib/data";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic"; // données par requête (auth-gated, fraîches)

export default async function Page() {
  const supabase = getSupabase();
  const initialProspects = await listProspects(supabase);
  return <DashboardClient initialProspects={initialProspects} />;
}
