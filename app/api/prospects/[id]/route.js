import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { logEvent } from "@/lib/events";
import { getProspectDetail } from "@/lib/data";

export const dynamic = "force-dynamic";

// Rafraîchissement client de la fiche (le 1er rendu vient du serveur via lib/data).
export async function GET(_request, { params }) {
  const result = await getProspectDetail(getSupabase(), params.id);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
}

export async function PATCH(request, { params }) {
  const supabase = getSupabase();
  const { id } = params;
  const body = await request.json();

  const allowed = ["first_name", "last_name", "role", "company", "company_website", "linkedin_url", "email", "phone", "status", "notes", "do_not_contact", "account_id"];
  const update = {};
  for (const key of allowed) if (key in body) update[key] = body[key];

  // Changement de statut ou de drapeau « ne pas contacter » : on relit l'état courant.
  let prevStatus = null;
  let prevDnc = false;
  const touchesStatus = "status" in update;
  const touchesDnc = "do_not_contact" in update;
  if (touchesStatus || touchesDnc) {
    const { data: p } = await supabase.from("prospects").select("email, status, do_not_contact").eq("id", id).single();
    prevStatus = p?.status ?? null;
    prevDnc = p?.do_not_contact ?? false;

    // Activation de l'opposition RGPD → inscription permanente en liste d'opposition
    // (par email, si connu). Un contact « téléphone seul » est tout de même marqué.
    if (update.do_not_contact === true && !prevDnc) {
      const email = (update.email || p?.email || "").toLowerCase();
      if (email) await supabase.from("optout").upsert({ email, reason: "demande du contact" });
    }
  }

  const { data, error } = await supabase.from("prospects").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (touchesStatus && prevStatus !== update.status) {
    logEvent({ kind: "status_change", prospectId: id, fromStatus: prevStatus, toStatus: update.status });
  }
  if (update.do_not_contact === true && !prevDnc) {
    logEvent({ kind: "opt_out", prospectId: id, note: "Marqué « ne pas contacter »" });
  }

  return NextResponse.json({ prospect: data });
}

export async function DELETE(_request, { params }) {
  const supabase = getSupabase();
  const { error } = await supabase.from("prospects").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
