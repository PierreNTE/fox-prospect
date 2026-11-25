import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getAccountDetail, getAccountSignals } from "@/lib/data";
import { pickStandard } from "@/lib/who-to-call";

export const dynamic = "force-dynamic";

// Rafraîchissement client de la fiche (le 1er rendu vient du serveur via lib/data).
// Doit renvoyer EXACTEMENT la même forme que le rendu serveur, signaux compris :
// sinon la carte de veille disparaît dès la première mutation de la fiche.
export async function GET(_request, { params }) {
  const supabase = getSupabase();
  const [result, signals] = await Promise.all([
    getAccountDetail(supabase, params.id),
    getAccountSignals(supabase, params.id),
  ]);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ...result, signals });
}

export async function PATCH(request, { params }) {
  const supabase = getSupabase();
  const { id } = params;
  const body = await request.json();

  const allowed = ["name", "website", "domain", "sector", "hq", "summary", "auto_watch", "call_status", "call_note", "recall_at"];
  const update = {};
  for (const key of allowed) if (key in body) update[key] = body[key] === "" && key === "recall_at" ? null : body[key];
  if ("call_status" in update || "call_note" in update || "recall_at" in update) update.call_updated_at = new Date().toISOString();
  if ("email_opt_out" in body) update.email_opt_out = !!body.email_opt_out;
  // Email saisi à la main : il passe devant les emails trouvés automatiquement.
  if ("found_email" in body) {
    const v = String(body.found_email || "").trim().toLowerCase().slice(0, 200);
    if (v && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) {
      return NextResponse.json({ error: "Email invalide." }, { status: 400 });
    }
    update.found_email = v || null;
    update.found_email_source = v ? "manuel" : null;
  }
  // Standard trouvé à la main : il passe devant les numéros trouvés automatiquement.
  if ("standard_phone" in body) {
    const v = String(body.standard_phone || "").replace(/[^\d+ .]/g, "").trim().slice(0, 30);
    update.standard_phone = v || null;
    update.standard_source = v ? "manuel" : null;
  }

  // « Numéro non attribué » : le numéro proposé est écarté pour de bon (le suivant prend sa place).
  if (update.call_status === "faux_numero") {
    const { data: cur } = await supabase.from("accounts")
      .select("standard_phone, standard_source, web_intel, call_prep, bad_phones").eq("id", id).maybeSingle();
    const std = cur ? pickStandard(cur)?.number : null;
    if (std) {
      update.bad_phones = [...new Set([...(cur.bad_phones || []), std])];
      if (cur.standard_phone === std) { update.standard_phone = null; update.standard_source = null; }
    }
  }

  const { data, error } = await supabase.from("accounts").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Résultat d'appel noté (log_call) : une ligne d'historique (tentatives, bilan de la semaine).
  // Les simples modifications de note ou de date de rappel ne sont pas des appels.
  if (body.log_call && update.call_status && update.call_status !== "a_appeler") {
    await supabase.from("call_log").insert({ account_id: id, outcome: update.call_status }).then(() => null, () => null);
  }
  return NextResponse.json({ account: data });
}

export async function DELETE(_request, { params }) {
  const supabase = getSupabase();
  const { error } = await supabase.from("accounts").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
