import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Cap produit : 25 Mo par fichier (bien en dessous du quota Storage gratuit,
// et de toute façon un devis/CR dépasse rarement quelques Mo).
const MAX_BYTES = 25 * 1024 * 1024;

// Prépare un upload DIRECT navigateur → Supabase Storage via URL signée.
// Le fichier ne transite JAMAIS par Vercel (limite 4,5 Mo par requête
// serverless) : cette route ne fait que signer, le PUT part du navigateur.
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const size = Number(body.size) || 0;
  if (size > MAX_BYTES) {
    return NextResponse.json({ error: "Fichier trop volumineux : 25 Mo maximum." }, { status: 400 });
  }

  // Nom de fichier assaini (affiché tel quel, mais la clé Storage doit rester sûre).
  const clean = String(body.name || "fichier")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .slice(0, 120) || "fichier";
  const path = `${crypto.randomUUID()}/${clean}`;

  const { data, error } = await getSupabase().storage.from("documents").createSignedUploadUrl(path);
  if (error) {
    return NextResponse.json(
      { error: `Storage indisponible : ${error.message}. Le bucket "documents" existe-t-il (migration v8) ?` },
      { status: 500 }
    );
  }
  return NextResponse.json({ path, signedUrl: data.signedUrl, token: data.token });
}
