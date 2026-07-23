// Composant SERVEUR : charge le pipeline (affaires + nom du compte) côté serveur.
import { getSupabase } from "@/lib/supabase";
import { getPipeline } from "@/lib/data";
import PipelineClient from "./PipelineClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initial = await getPipeline(getSupabase());
  return <PipelineClient initial={initial} />;
}
