import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("prospects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prospects: data });
}

export async function POST(request) {
  const supabase = getSupabase();
  const body = await request.json();
  const rows = Array.isArray(body) ? body : [body];

  // Filtre la liste d'opposition : on n'importe jamais un email opt-out.
  const { data: optouts } = await supabase.from("optout").select("email");
  const blocked = new Set((optouts || []).map((o) => o.email.toLowerCase()));

  // Dédoublonnage contre l'existant : même email, ou même nom + entreprise.
  const { data: existing } = await supabase
    .from("prospects")
    .select("email, first_name, last_name, company");
  const knownEmails = new Set(
    (existing || []).filter((p) => p.email).map((p) => p.email.toLowerCase())
  );
  const knownPeople = new Set(
    (existing || []).map((p) =>
      `${p.first_name}|${p.last_name}|${p.company}`.toLowerCase()
    )
  );

  const normalizeUrl = (u) => {
    const v = (u || "").trim();
    if (!v) return "";
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  };

  const seen = new Set(); // doublons à l'intérieur du fichier importé lui-même
  const clean = [];
  let duplicates = 0;

  for (const r of rows) {
    if (!r.company || (!r.first_name && !r.last_name)) continue;
    const email = (r.email || "").trim().toLowerCase();
    if (email && blocked.has(email)) continue;

    const personKey = `${r.first_name || ""}|${r.last_name || ""}|${r.company}`.toLowerCase();
    if ((email && knownEmails.has(email)) || knownPeople.has(personKey) || seen.has(personKey)) {
      duplicates++;
      continue;
    }
    seen.add(personKey);

    clean.push({
      first_name: (r.first_name || "").trim(),
      last_name: (r.last_name || "").trim(),
      role: (r.role || "").trim(),
      company: (r.company || "").trim(),
      company_website: normalizeUrl(r.company_website),
      linkedin_url: normalizeUrl(r.linkedin_url),
      email: (r.email || "").trim(),
    });
  }

  if (clean.length === 0) {
    return NextResponse.json(
      {
        error: duplicates
          ? `Aucun nouveau prospect : ${duplicates} doublon(s) déjà sur la piste.`
          : "Aucune ligne valide (entreprise + nom requis, opt-out exclus).",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.from("prospects").insert(clean).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Rattachement automatique à un compte (créé si absent) pour la vue par entreprise.
  for (const p of data) {
    const company = (p.company || "").trim();
    if (!company) continue;
    let accountId = null;
    const { data: acc } = await supabase.from("accounts").select("id").ilike("name", company).limit(1);
    if (acc && acc.length) accountId = acc[0].id;
    else {
      const { data: created } = await supabase
        .from("accounts")
        .insert({ name: company, website: p.company_website || "" })
        .select("id")
        .single();
      accountId = created?.id || null;
    }
    if (accountId) await supabase.from("prospects").update({ account_id: accountId }).eq("id", p.id);
  }

  return NextResponse.json({
    inserted: data.length,
    skipped: rows.length - clean.length,
    duplicates,
  });
}
