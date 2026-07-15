import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Enfile une ré-analyse (kind=analyze_account) pour tous les comptes surveillés
// (auto_watch=true), afin de rafraîchir le stock existant au nouveau format
// (actualités 12 mois, organigramme enrichi). Le cron /api/cron/refresh-accounts
// draine la file progressivement, borné par le kill-switch budget mensuel — donc
// aucun dépassement possible. Idempotent : dédup contre les jobs déjà en file.
export async function POST() {
  const supabase = getSupabase();

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("auto_watch", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (accounts || []).map((a) => a.id);
  if (ids.length === 0) return NextResponse.json({ enqueued: 0, reason: "aucun compte surveillé" });

  // Exclure ceux déjà en file (pending/running) pour éviter les doublons.
  const { data: pending } = await supabase
    .from("jobs")
    .select("payload")
    .eq("kind", "analyze_account")
    .in("status", ["pending", "running"]);
  const queued = new Set((pending || []).map((j) => j.payload?.account_id).filter(Boolean));

  const toQueue = ids.filter((id) => !queued.has(id));
  if (toQueue.length === 0) return NextResponse.json({ enqueued: 0, reason: "déjà tous en file" });

  const rows = toQueue.map((id) => ({
    kind: "analyze_account",
    payload: { account_id: id },
    status: "pending",
  }));
  const { data: ins, error: insErr } = await supabase.from("jobs").insert(rows).select("id");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ enqueued: ins?.length ?? 0, total_watched: ids.length });
}
