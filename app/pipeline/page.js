import { getSupabase } from "@/lib/supabase";
import { listProspects } from "@/lib/data";
import PipelineClient from "./PipelineClient";

export const dynamic = "force-dynamic";

// Vue kanban du funnel commercial — rendu serveur comme la liste (données
// dans le HTML au premier affichage), mutations côté client ensuite.
export default async function PipelinePage() {
  const prospects = await listProspects(getSupabase()).catch(() => null);
  return <PipelineClient initialProspects={prospects} />;
}
