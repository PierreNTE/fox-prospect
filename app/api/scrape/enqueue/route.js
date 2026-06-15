import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

const ALLOWED_KINDS = ["discover", "enrich", "discover_and_enrich"];

// POST /api/scrape/enqueue
// Met un job de scraping dans la file (status=pending), journalise un event, et
// déclenche le worker GitHub Actions via repository_dispatch si un PAT est configuré.
// Dégradation gracieuse : sans PAT, le cron prendra le relais.
export async function POST(request) {
  const supabase = getSupabase();
  const body = await request.json().catch(() => ({}));

  const kind = ALLOWED_KINDS.includes(body.kind) ? body.kind : "discover_and_enrich";
  const params = {
    account_id: body.account_id ?? null,
    company: (body.company || "").trim(),
    domain: (body.domain || "").trim(),
    limit: Number(body.limit) || 8,
  };
  if (!params.account_id && !params.company) {
    return NextResponse.json({ error: "Renseigne un compte ou une entreprise." }, { status: 400 });
  }

  const { data: job, error } = await supabase
    .from("scrape_jobs")
    .insert({ kind, params, created_by: "app" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logEvent({
    kind: "auto_action",
    accountId: params.account_id,
    note: `scrape:enqueued ${kind} (${params.company || params.account_id})`,
  });

  // Déclenchement quasi-immédiat (sinon le cron de 6 h prendra le relais).
  let dispatched = false;
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (token && repo) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
          "user-agent": "fox-prospect",
        },
        body: JSON.stringify({ event_type: "scrape", client_payload: { job_id: job.id } }),
      });
      dispatched = res.status === 204; // GitHub renvoie 204 No Content sur succès
      if (!dispatched) {
        console.error("[scrape] dispatch échec:", res.status, (await res.text()).slice(0, 200));
      }
    } catch (e) {
      console.error("[scrape] dispatch erreur:", e.message);
    }
  }

  return NextResponse.json({ job, dispatched });
}
