import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const CHANNELS = ["appel", "email", "linkedin", "autre"];

// POST /api/prospects/[id]/interactions
// Enregistre un échange commercial dans la timeline (events kind='interaction')
// et met à jour le plan de relance courant du prospect (dénormalisé).
export async function POST(request, { params }) {
  const supabase = getSupabase();
  const { id } = params;
  const body = await request.json().catch(() => ({}));

  const channel = String(body.channel || "").trim().toLowerCase();
  const note = String(body.note || "").trim();
  const nextAction = String(body.next_action || "").trim();
  const followUpAt = body.follow_up_at || null; // 'YYYY-MM-DD' | null
  const occurredAt = body.occurred_at || null;  // 'YYYY-MM-DD' | null → défaut now()

  if (!CHANNELS.includes(channel)) {
    return NextResponse.json({ error: "Canal invalide (appel, email, linkedin ou autre)." }, { status: 400 });
  }
  if (!note && !nextAction) {
    return NextResponse.json({ error: "Renseigne au moins un compte-rendu ou une prochaine action." }, { status: 400 });
  }

  // 1) Événement d'interaction (timeline append-only).
  const insert = {
    prospect_id: id,
    kind: "interaction",
    channel,
    note: note || null,
    next_action: nextAction || null,
    follow_up_at: followUpAt,
  };
  if (occurredAt) insert.occurred_at = occurredAt;

  const { data: event, error } = await supabase.from("events").insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 2) Plan courant du prospect : on ne touche au plan de relance QUE si le
  //    formulaire fournit une nouvelle valeur — logger un simple compte-rendu
  //    (« messagerie vocale laissée ») ne doit jamais effacer une relance
  //    déjà planifiée.
  const planUpdate = {};
  if (nextAction) planUpdate.next_action = nextAction;
  if (followUpAt) planUpdate.follow_up_at = followUpAt;
  if (Object.keys(planUpdate).length > 0) {
    await supabase.from("prospects").update(planUpdate).eq("id", id);
  }

  return NextResponse.json({ event });
}
