import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET — liste des jobs en attente ou récents (pour affichage dans l'UI).
export async function GET() {
  const supabase = getSupabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, kind, status, attempts, last_error, scheduled_at, done_at, payload")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: jobs || [] });
}

// POST — enfile un ou plusieurs jobs (bulk si payload.items est un tableau).
export async function POST(request) {
  const supabase = getSupabase();
  const body = await request.json();
  const { kind, items } = body; // items = [{ account_id }] ou body = { kind, payload }

  const VALID_KINDS = ["analyze_account", "research_prospect", "enrich_prospect"];
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: `Kind invalide. Valeurs : ${VALID_KINDS.join(", ")}` }, { status: 400 });
  }

  // Mode bulk : array d'items
  if (Array.isArray(items)) {
    const rows = items.map((payload) => ({ kind, payload, status: "pending" }));
    const { data, error } = await supabase.from("jobs").insert(rows).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ enqueued: data?.length ?? 0 });
  }

  // Mode simple : un seul job
  const { payload } = body;
  const { data, error } = await supabase
    .from("jobs")
    .insert({ kind, payload: payload || {}, status: "pending" })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
