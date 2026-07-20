import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { listAccounts } from "@/lib/data";

export const dynamic = "force-dynamic";

// Rafraîchissement client de la liste (le 1er rendu vient du serveur via lib/data).
export async function GET() {
  return NextResponse.json({ accounts: await listAccounts(getSupabase()) });
}

export async function POST(request) {
  const supabase = getSupabase();
  const body = await request.json();
  const name = (body.name || "").trim();
  if (!name) return NextResponse.json({ error: "Le nom de l'entreprise est requis." }, { status: 400 });

  const normalizeUrl = (u) => {
    const v = (u || "").trim();
    if (!v) return "";
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  };

  // Idempotent sur le nom (insensible à la casse) : on ne crée pas de doublon.
  const { data: existing } = await supabase
    .from("accounts")
    .select("*")
    .ilike("name", name)
    .limit(1);
  if (existing && existing.length) {
    return NextResponse.json({ account: existing[0], existed: true });
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({ name, website: normalizeUrl(body.website), sector: (body.sector || "").trim() })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data });
}
