import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { findTemplate } from "@/lib/sequences";

export const dynamic = "force-dynamic";

// Enrôle un prospect dans une cadence : crée une tâche datée par étape dans
// `tasks`. Aucun envoi — juste des rendez-vous d'action dans l'agenda.
export async function POST(request) {
  const supabase = getSupabase();
  const body = await request.json();
  const tpl = findTemplate(body.template_key);
  if (!tpl) return NextResponse.json({ error: "Séquence inconnue." }, { status: 400 });
  if (!body.prospect_id) return NextResponse.json({ error: "prospect_id requis." }, { status: 400 });

  const base = Date.now();
  const rows = tpl.steps.map((s) => ({
    title: `${tpl.label} — ${s.title}`,
    kind: s.kind,
    due_date: new Date(base + s.day * 86400000).toISOString().slice(0, 10),
    prospect_id: body.prospect_id,
    account_id: body.account_id || null,
    notes: "",
  }));

  const { data, error } = await supabase.from("tasks").insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ created: (data || []).length });
}
