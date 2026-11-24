import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { listSalesforceLeads } from "@/lib/leads-import";
import { deleteAllLeads } from "@/lib/leads-reset";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ leads: await listSalesforceLeads(getSupabase()) });
}

// DELETE /api/leads { confirm: "SUPPRIMER" } — supprime tous les leads Salesforce
// (avant de réimporter une liste propre). La confirmation évite un appel accidentel.
export async function DELETE(request) {
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== "SUPPRIMER") {
    return NextResponse.json({ error: "Confirmation manquante." }, { status: 400 });
  }
  try {
    return NextResponse.json(await deleteAllLeads(getSupabase()));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
