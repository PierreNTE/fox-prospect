import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const CATEGORIES = ["devis", "compte_rendu", "contrat", "presentation", "autre"];

// Liste des documents d'une cible.
// - ?prospectId=X  → documents rattachés à ce prospect
// - ?accountId=X   → AGRÉGATION : documents du compte + de ses contacts
//   d'organigramme (badge « via Prénom Nom ») + de ses prospects rattachés.
//   Un seul endroit pour tout retrouver, sans double classement.
export async function GET(request) {
  const supabase = getSupabase();
  const sp = new URL(request.url).searchParams;
  const prospectId = sp.get("prospectId");
  const accountId = sp.get("accountId");

  if (prospectId) {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ documents: data || [] });
  }

  if (accountId) {
    const [{ data: contacts }, { data: prospects }] = await Promise.all([
      supabase.from("account_contacts").select("id, first_name, last_name").eq("account_id", accountId),
      supabase.from("prospects").select("id, first_name, last_name").eq("account_id", accountId),
    ]);
    const contactIds = (contacts || []).map((c) => c.id);
    const prospectIds = (prospects || []).map((p) => p.id);

    const parts = [`account_id.eq.${accountId}`];
    if (contactIds.length) parts.push(`account_contact_id.in.(${contactIds.join(",")})`);
    if (prospectIds.length) parts.push(`prospect_id.in.(${prospectIds.join(",")})`);

    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .or(parts.join(","))
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Badge « via » : d'où vient le document quand il n'est pas rattaché
    // directement au compte.
    const contactName = new Map((contacts || []).map((c) => [c.id, `${c.first_name || ""} ${c.last_name || ""}`.trim()]));
    const prospectName = new Map((prospects || []).map((p) => [p.id, `${p.first_name || ""} ${p.last_name || ""}`.trim()]));
    const documents = (data || []).map((d) => ({
      ...d,
      via: d.account_contact_id
        ? contactName.get(d.account_contact_id) || "contact"
        : d.prospect_id
          ? prospectName.get(d.prospect_id) || "prospect"
          : null,
    }));
    return NextResponse.json({ documents });
  }

  return NextResponse.json({ error: "Paramètre prospectId ou accountId requis." }, { status: 400 });
}

// Finalisation : enregistre la fiche du document APRÈS l'upload direct réussi
// (navigateur → Storage). N'accepte qu'UNE cible (même règle que le CHECK SQL).
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const targets = [body.account_id, body.prospect_id, body.account_contact_id].filter(Boolean);
  if (targets.length !== 1) {
    return NextResponse.json({ error: "Un document se rattache à exactement une cible (compte, prospect ou contact)." }, { status: 400 });
  }
  if (!body.path || !body.name) {
    return NextResponse.json({ error: "path et name requis." }, { status: 400 });
  }
  const category = CATEGORIES.includes(body.category) ? body.category : "autre";

  const { data, error } = await getSupabase()
    .from("documents")
    .insert({
      account_id: body.account_id || null,
      prospect_id: body.prospect_id || null,
      account_contact_id: body.account_contact_id || null,
      path: body.path,
      name: String(body.name).slice(0, 200),
      mime: body.mime || "",
      size_bytes: Number(body.size_bytes) || 0,
      category,
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 10) : [],
      note: body.note || "",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ document: data });
}
