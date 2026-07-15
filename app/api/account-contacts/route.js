import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request) {
  // Ajout manuel d'un contact à un compte (saisi par Pierre = vérifié).
  const supabase = getSupabase();
  const body = await request.json();
  if (!body.account_id) return NextResponse.json({ error: "account_id requis." }, { status: 400 });
  if (!body.first_name && !body.last_name) {
    return NextResponse.json({ error: "Au moins un nom est requis." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("account_contacts")
    .insert({
      account_id: body.account_id,
      first_name: (body.first_name || "").trim(),
      last_name: (body.last_name || "").trim(),
      role: (body.role || "").trim(),
      department: (body.department || "").trim(),
      level: (body.level || "").trim(),
      email: (body.email || "").trim(),
      phone: (body.phone || "").trim(),
      linkedin_url: (body.linkedin_url || "").trim(),
      manager_id: body.manager_id || null,
      reliability: "verifie",
      role_confidence: "certain",
      validated: true,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data });
}
