// Composant SERVEUR : charge la fiche complète côté serveur (prospect + recherche
// + brouillons + timeline + brief) et la passe au composant client. Le HTML arrive
// rempli → plus d'attente « charger le JS → fetch » à l'ouverture d'une fiche.
import { getSupabase } from "@/lib/supabase";
import { getProspectDetail } from "@/lib/data";
import { notFound } from "next/navigation";
import ProspectClient from "./ProspectClient";

export const dynamic = "force-dynamic";

export default async function Page({ params }) {
  const { id } = params;
  const data = await getProspectDetail(getSupabase(), id);
  if (data.error || !data.prospect) notFound();
  // key={id} → remount propre quand on passe d'une fiche à une autre.
  return <ProspectClient key={id} id={id} initialData={data} />;
}
