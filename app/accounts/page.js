// Composant SERVEUR : liste des comptes chargée côté serveur et passée en props
// au composant client — même pattern que la liste prospects (/).
import { Suspense } from "react";
import { getSupabase } from "@/lib/supabase";
import { listAccounts, getVeille } from "@/lib/data";
import AccountsClient from "./AccountsClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const supabase = getSupabase();
  const [initialAccounts, veille] = await Promise.all([listAccounts(supabase), getVeille(supabase)]);
  // Suspense requis : AccountsClient lit useSearchParams (filtre q dans l'URL).
  return (
    <Suspense>
      <AccountsClient initialAccounts={initialAccounts} veille={veille} />
    </Suspense>
  );
}
