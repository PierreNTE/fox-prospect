import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { listProspects } from "@/lib/data";
import { resolveSiren, upsertCompany } from "@/lib/sirene";

export const dynamic = "force-dynamic";

// Rafraîchissement client de la liste (le 1er rendu vient du serveur via lib/data).
export async function GET() {
  return NextResponse.json({ prospects: await listProspects(getSupabase()) });
}

export async function POST(request) {
  const supabase = getSupabase();
  const body = await request.json();
  const rows = Array.isArray(body) ? body : [body];

  // Requêtes de dédup BORNÉES par le contenu de l'import (l'ancien code
  // chargeait toute la table prospects — O(n) mémoire, mort à l'échelle).
  const emails = [...new Set(rows.map((r) => (r.email || "").trim().toLowerCase()).filter(Boolean))];
  const companies = [...new Set(rows.map((r) => (r.company || "").trim()).filter(Boolean))];

  const [{ data: optouts }, { data: byEmail }] = await Promise.all([
    emails.length
      ? supabase.from("optout").select("email").in("email", emails)
      : Promise.resolve({ data: [] }),
    emails.length
      ? supabase.from("prospects").select("email").in("email", emails)
      : Promise.resolve({ data: [] }),
  ]);
  const blocked = new Set((optouts || []).map((o) => o.email.toLowerCase()));
  const knownEmails = new Set((byEmail || []).map((p) => (p.email || "").toLowerCase()));

  // Dédup nom+entreprise : une requête ilike par entreprise distincte de
  // l'import (bornée par la taille du fichier, insensible à la casse).
  const knownPeople = new Set();
  for (const company of companies) {
    const { data: sameCompany } = await supabase
      .from("prospects")
      .select("first_name, last_name, company")
      .ilike("company", company);
    for (const p of sameCompany || []) {
      knownPeople.add(`${p.first_name}|${p.last_name}|${p.company}`.toLowerCase());
    }
  }

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
      email: (r.email || "").trim().toLowerCase(),
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

      // Couplage accounts→companies dès la création (fusion-lite, audit §1.2) :
      // résolution SIREN non bloquante, le compte est rattaché quand elle aboutit.
      if (accountId) {
        const domain = (p.company_website || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        resolveSiren({ name: company, domain })
          .then(async (sireneData) => {
            if (!sireneData) return;
            const companyId = await upsertCompany(supabase, sireneData, domain ? { domain } : {});
            if (companyId) {
              await supabase.from("accounts").update({ company_id: companyId }).eq("id", accountId);
            }
          })
          .catch(() => {});
      }
    }
    if (accountId) await supabase.from("prospects").update({ account_id: accountId }).eq("id", p.id);
  }

  return NextResponse.json({
    inserted: data.length,
    skipped: rows.length - clean.length,
    duplicates,
  });
}
