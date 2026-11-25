import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { listSalesforceLeads } from "@/lib/leads-import";
import { parseSentEmails, planSentEmails, SENT_STATUS } from "@/lib/sent-emails";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/leads/sent-emails { text, source } — liste des emails envoyés
// (agent Sales Chat « suivi des envois » ou copie / export Outlook).
// Chaque envoi est rattaché à son lead et enregistré une seule fois ;
// la réponse liste les erreurs (doublons, STOP, lead clos, adresse douteuse…).
// Les adresses internes Dell et les envois hors liste ne sont jamais enregistrés.
export async function POST(request) {
  const { text, source } = await request.json().catch(() => ({}));
  if (!String(text || "").trim()) return NextResponse.json({ error: "Colle la liste de tes emails envoyés." }, { status: 400 });
  const { rows, internal, columns } = parseSentEmails(String(text).slice(0, 500000));
  if (!rows.length) {
    return NextResponse.json({
      error: "Aucun email envoyé reconnu. Il faut au moins l'adresse ou le nom du destinataire par ligne.",
      colonnes: columns,
    }, { status: 400 });
  }
  const supabase = getSupabase();
  const leads = await listSalesforceLeads(supabase);
  const plan = planSentEmails(rows, leads);

  // Statut le plus avancé conservé (« réponse » ne redevient jamais « envoyé »).
  const keys = plan.entries.map((e) => e.dedup_key);
  const known = new Map();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await supabase.from("email_log").select("dedup_key, status").in("dedup_key", keys.slice(i, i + 200));
    for (const r of data || []) known.set(r.dedup_key, r.status);
  }
  const now = new Date().toISOString();
  const records = plan.entries.map((e) => {
    const prev = known.get(e.dedup_key);
    const status = prev && (SENT_STATUS[prev]?.rank ?? 0) > SENT_STATUS[e.status].rank ? prev : e.status;
    return {
      account_id: e.account_id, to_email: e.to_email, to_name: e.to_name, subject: e.subject,
      sent_at: e.sent_at, status, source: String(source || "collé").slice(0, 40), dedup_key: e.dedup_key, updated_at: now,
    };
  });
  let saved = 0;
  for (let i = 0; i < records.length; i += 200) {
    const { error, count } = await supabase.from("email_log")
      .upsert(records.slice(i, i + 200), { onConflict: "dedup_key", count: "exact" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    saved += count ?? records.slice(i, i + 200).length;
  }
  let updated = 0;
  for (const { id, ...patch } of plan.updates) {
    const { error } = await supabase.from("accounts").update(patch).eq("id", id);
    if (!error) updated++;
  }
  return NextResponse.json({
    lus: rows.length,
    enregistres: saved,
    nouveaux: records.filter((r) => !known.has(r.dedup_key)).length,
    deja_connus: records.filter((r) => known.has(r.dedup_key)).length,
    internes_ignores: internal,
    hors_liste: plan.unmatched.length,
    hors_liste_exemples: plan.unmatched.slice(0, 5),
    leads_mis_a_jour: updated,
    erreurs: plan.issues,
  });
}
