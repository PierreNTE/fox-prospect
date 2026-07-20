import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Fait apparaître dans l'organigramme les prospects rattachés au compte qui
// n'y figurent pas encore (cas typique : import CSV ou promotion scraping — le
// prospect est créé avec account_id mais sans fiche account_contacts, donc
// visible dans « Prospects en cours » mais absent de l'organigramme).
// Match par prénom+nom insensible à la casse ; les fiches créées sont liées
// via prospect_id et héritent des coordonnées du prospect.
export async function POST(_request, { params }) {
  const supabase = getSupabase();
  const accountId = params.id;

  const [{ data: contacts }, { data: prospects, error }] = await Promise.all([
    supabase.from("account_contacts").select("id, first_name, last_name, prospect_id").eq("account_id", accountId),
    supabase.from("prospects").select("id, first_name, last_name, role, email, phone, linkedin_url").eq("account_id", accountId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const known = new Set();
  for (const c of contacts || []) {
    known.add(`${(c.first_name || "").trim()}|${(c.last_name || "").trim()}`.toLowerCase());
    if (c.prospect_id) known.add(`p:${c.prospect_id}`);
  }

  const missing = (prospects || []).filter(
    (p) =>
      !known.has(`p:${p.id}`) &&
      !known.has(`${(p.first_name || "").trim()}|${(p.last_name || "").trim()}`.toLowerCase())
  );
  if (missing.length === 0) return NextResponse.json({ added: 0 });

  const { error: insertError } = await supabase.from("account_contacts").insert(
    missing.map((p) => ({
      account_id: accountId,
      prospect_id: p.id,
      first_name: p.first_name || "",
      last_name: p.last_name || "",
      role: p.role || "",
      email: p.email || "",
      phone: p.phone || "",
      linkedin_url: p.linkedin_url || "",
      // Un prospect réel n'est pas une « proposition IA » : validé d'office ;
      // fiabilité selon la présence d'une coordonnée directe.
      validated: true,
      reliability: `${p.email || ""}${p.phone || ""}`.trim() ? "partiel" : "non_verifie",
    }))
  );
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ added: missing.length });
}
