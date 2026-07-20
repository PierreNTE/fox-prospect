import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// URL signée de lecture (60 s) : le navigateur ouvre le fichier directement
// depuis le CDN Supabase (prévisualisation native PDF/image), rien ne transite
// par Vercel.
export async function GET(_request, { params }) {
  const supabase = getSupabase();
  const { data: doc, error } = await supabase.from("documents").select("path, name").eq("id", params.id).single();
  if (error || !doc) return NextResponse.json({ error: "Document introuvable." }, { status: 404 });

  const { data, error: signError } = await supabase.storage.from("documents").createSignedUrl(doc.path, 60);
  if (signError) return NextResponse.json({ error: signError.message }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl, name: doc.name });
}

export async function DELETE(_request, { params }) {
  const supabase = getSupabase();
  const { data: doc, error } = await supabase.from("documents").select("path").eq("id", params.id).single();
  if (error || !doc) return NextResponse.json({ error: "Document introuvable." }, { status: 404 });

  // Fichier d'abord, fiche ensuite : si la suppression Storage échoue, la fiche
  // reste visible (pas de fichier orphelin invisible qui consomme le quota).
  const { error: removeError } = await supabase.storage.from("documents").remove([doc.path]);
  if (removeError) return NextResponse.json({ error: removeError.message }, { status: 500 });

  const { error: deleteError } = await supabase.from("documents").delete().eq("id", params.id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
