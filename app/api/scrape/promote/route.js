import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

// POST /api/scrape/promote { result_id }
// Promeut un résultat de scraping en prospect (statut 'non_contacte'), avec contrôle
// opt-out côté serveur. La qualification 2 passes est ensuite déclenchée par le
// client via /api/research (qui porte le cookie de session).
export async function POST(request) {
  const supabase = getSupabase();
  const { result_id } = await request.json().catch(() => ({}));
  if (!result_id) {
    return NextResponse.json({ error: "result_id requis." }, { status: 400 });
  }

  const { data: r, error } = await supabase
    .from("scrape_results")
    .select("*")
    .eq("id", result_id)
    .single();
  if (error || !r) {
    return NextResponse.json({ error: "Résultat introuvable." }, { status: 404 });
  }
  if (r.prospect_id) {
    return NextResponse.json({ prospect_id: r.prospect_id, already: true });
  }

  // Conformité : jamais de promotion d'un email en liste d'opposition.
  const email = (r.email || "").trim();
  if (email) {
    const { data: opt } = await supabase
      .from("optout")
      .select("email")
      .eq("email", email.toLowerCase())
      .limit(1);
    if (opt && opt.length) {
      return NextResponse.json({ error: "Contact en liste d'opposition (opt-out)." }, { status: 409 });
    }
  }

  // Même règle produit que POST /api/prospects : pas de prospect injoignable
  // (ni email, ni LinkedIn — le scraping ne fournit pas de téléphone).
  if (!email && !(r.linkedin_url || "").trim()) {
    return NextResponse.json(
      { error: "Contact sans aucune coordonnée (email ou LinkedIn) : enrichis-le avant de le promouvoir." },
      { status: 400 }
    );
  }

  const parts = (r.full_name || "").trim().split(/\s+/);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || firstName;
  const companyWebsite = email.includes("@") ? `https://${email.split("@")[1]}` : "";

  const { data: prospect, error: insErr } = await supabase
    .from("prospects")
    .insert({
      first_name: firstName,
      last_name: lastName,
      role: r.title || "",
      company: r.company || "",
      company_website: companyWebsite,
      linkedin_url: r.linkedin_url || "",
      email,
      email_confidence: r.email_confidence || "",
      email_source: r.email_source || "",
      status: "non_contacte",
      account_id: r.account_id || null,
      notes: r.source ? `Importé via scraping — source : ${r.source}` : "",
    })
    .select()
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // Lie le résultat au prospect (évite la double-promotion).
  await supabase.from("scrape_results").update({ prospect_id: prospect.id }).eq("id", result_id);

  logEvent({
    kind: "auto_action",
    accountId: r.account_id,
    prospectId: prospect.id,
    note: "scrape:promoted",
  });

  return NextResponse.json({ prospect });
}
