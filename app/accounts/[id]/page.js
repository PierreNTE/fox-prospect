// Composant SERVEUR : charge la fiche compte côté serveur (co-localisé avec
// Supabase) et la passe au composant client — même pattern que /prospects/[id].
// Fin de la cascade « shell → JS → fetch » sur la page centrale du produit.
import { getSupabase } from "@/lib/supabase";
import { getAccountDetail, getAccountSignals } from "@/lib/data";
import { notFound } from "next/navigation";
import AccountClient from "./AccountClient";

export const dynamic = "force-dynamic";

export default async function Page({ params }) {
  const { id } = params;
  const supabase = getSupabase();
  // En parallèle : les signaux ne conditionnent pas l'affichage de la fiche,
  // ils ne doivent donc pas la retarder.
  const [data, signals] = await Promise.all([
    getAccountDetail(supabase, id),
    getAccountSignals(supabase, id),
  ]);
  if (data.error || !data.account) notFound();
  // key={id} → remount propre quand on passe d'une fiche à une autre.
  return <AccountClient key={id} id={id} initialData={{ ...data, signals }} />;
}
