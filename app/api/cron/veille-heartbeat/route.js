import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Signal de vie du passage de veille.
//
// Un cron qui échoue ouvre une issue. Un cron que GitHub a DÉSACTIVÉ après
// 60 jours sans activité sur le dépôt n'échoue pas : il se tait. Aucune alerte
// d'échec ne peut détecter ce cas, parce qu'il ne se produit rien à détecter.
//
// La règle qui rend un signal de vie utile : le détecteur doit vivre AILLEURS
// que le système surveillé. GitHub ne peut pas signaler qu'il a coupé son
// propre cron. C'est donc le cron Vercel (/api/cron/refresh-accounts) et
// /api/health qui lisent l'âge du dernier battement — deux hébergeurs, deux
// pannes indépendantes.
//
// La route s'authentifie comme les autres tâches planifiées : Bearer CRON_SECRET
// dans l'en-tête, jamais dans l'URL — un secret en query string se retrouve
// dans les journaux d'accès de tout ce qu'il traverse.
export async function GET(request) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (secret) {
    const auth = (request.headers.get("authorization") || "").trim();
    if (auth.replace(/^Bearer\s+/i, "").trim() !== secret) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  const { error } = await supabase.from("pipeline_runs").insert({
    stage: "heartbeat",
    run_ref: new URL(request.url).searchParams.get("run") || null,
    finished_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
