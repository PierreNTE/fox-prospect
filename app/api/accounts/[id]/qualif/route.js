import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { sanitizeQualif } from "@/lib/dell-qualif";

export const dynamic = "force-dynamic";

// Enregistre la fiche de qualification Dell (serveurs / stockage / backup / BANT).
export async function PUT(request, { params }) {
  const body = await request.json().catch(() => ({}));
  const qualif = sanitizeQualif(body.qualif);
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from("accounts")
    .update({ dell_qualif: qualif, dell_qualif_at: now })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ qualif, saved_at: now });
}
