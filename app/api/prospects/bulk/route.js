import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { PROSPECT_STATUS } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Actions en masse (Sprint 3) — le tri de 20 prospects passait par 20 fiches.
// POST { ids: uuid[], action: "set_status"|"add_tag"|"remove_tag"|"qualify", value? }
export async function POST(request) {
  const supabase = getSupabase();
  const { ids, action, value } = await request.json().catch(() => ({}));

  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
    return NextResponse.json({ error: "ids requis (1 à 200 prospects)." }, { status: 400 });
  }

  if (action === "set_status") {
    if (!Object.values(PROSPECT_STATUS).includes(value)) {
      return NextResponse.json({ error: `Statut inconnu : ${value}` }, { status: 400 });
    }
    const { error } = await supabase.from("prospects").update({ status: value }).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Timeline : un événement par prospect, en un seul insert.
    await supabase.from("events").insert(
      ids.map((id) => ({ prospect_id: id, kind: "status_change", to_status: value, note: "action en masse" }))
    );
    return NextResponse.json({ updated: ids.length });
  }

  if (action === "add_tag" || action === "remove_tag") {
    const tag = String(value || "").trim().toLowerCase();
    if (!tag) return NextResponse.json({ error: "Tag vide." }, { status: 400 });

    // array_append/array_remove n'ont pas d'équivalent direct en PostgREST :
    // lecture bornée puis updates ciblés (≤ 200 lignes par appel).
    const { data: rows } = await supabase.from("prospects").select("id, tags").in("id", ids);
    const updates = (rows || [])
      .map((r) => {
        const tags = new Set(r.tags || []);
        if (action === "add_tag") tags.add(tag); else tags.delete(tag);
        return { id: r.id, tags: [...tags] };
      });
    await Promise.all(
      updates.map((u) => supabase.from("prospects").update({ tags: u.tags }).eq("id", u.id))
    );
    return NextResponse.json({ updated: updates.length });
  }

  if (action === "qualify") {
    // Enfile un job de qualification par prospect non déjà en file — le drain
    // (cron/worker) les traite sous plafond quotidien + kill-switch budget.
    const { data: pending } = await supabase
      .from("jobs")
      .select("payload")
      .eq("kind", "research_prospect")
      .in("status", ["pending", "running"]);
    const queued = new Set((pending || []).map((j) => j.payload?.prospect_id).filter(Boolean));

    const rows = ids.filter((id) => !queued.has(id))
      .map((id) => ({ kind: "research_prospect", payload: { prospect_id: id }, status: "pending" }));
    if (rows.length) {
      const { error } = await supabase.from("jobs").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ enqueued: rows.length, skipped: ids.length - rows.length });
  }

  return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
}
