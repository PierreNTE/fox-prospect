import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Cache mémoire 7 jours par URL : chaque ouverture de la même fiche relançait
// jusqu'à 10 requêtes HTTP externes identiques. Une Map au niveau module
// survit tant que l'instance Fluid reste chaude (le cas courant en usage
// quotidien) ; après un cold start, on revérifie — acceptable pour une info
// qui change rarement.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cache = new Map(); // url → { at: epoch_ms, result }

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
  const now = Date.now();

  const fresh = [];
  for (const url of limit) {
    const hit = cache.get(url);
    if (hit && now - hit.at < CACHE_TTL_MS) results[url] = hit.result;
    else fresh.push(url);
  }

  await Promise.allSettled(
    fresh.map(async (url) => {
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

  // Alimente le cache avec les vérifications fraîches.
  for (const url of fresh) {
    if (results[url]) cache.set(url, { at: now, result: results[url] });
  }

  return NextResponse.json({ results });
}
