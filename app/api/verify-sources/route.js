import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Vérifie l'accessibilité d'une liste d'URLs sources (V1-10).
// HEAD fetch avec timeout court — retourne le statut HTTP de chaque URL.
// Non bloquant pour l'UX : appelé en arrière-plan après l'affichage de la fiche.
export async function POST(request) {
  const { urls } = await request.json();
  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ results: {} });
  }

  const limit = urls.slice(0, 10); // max 10 URLs par appel
  const results = {};

  await Promise.allSettled(
    limit.map(async (url) => {
      if (!url || !url.startsWith("http")) {
        results[url] = { ok: false, status: null, reason: "url_invalide" };
        return;
      }
      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(5_000),
          headers: { "user-agent": "Mozilla/5.0 (compatible; FoxProspect/1.0)" },
        });
        results[url] = { ok: res.ok, status: res.status };
      } catch (e) {
        // Certains serveurs bloquent HEAD → retenter avec GET tronqué.
        try {
          const res = await fetch(url, {
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(5_000),
            headers: { "user-agent": "Mozilla/5.0 (compatible; FoxProspect/1.0)", range: "bytes=0-0" },
          });
          results[url] = { ok: res.ok || res.status === 206, status: res.status };
        } catch {
          results[url] = { ok: false, status: null, reason: "timeout_ou_reseau" };
        }
      }
    })
  );

  return NextResponse.json({ results });
}
