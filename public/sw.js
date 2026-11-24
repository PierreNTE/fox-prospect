// Service worker v4 — la fraîcheur d'abord (outil de travail quotidien) :
//  - pages et API : réseau d'abord, le cache ne sert qu'hors ligne (plus de
//    page de la veille servie parce que le serveur a mis plus de 3 s) ;
//  - téléchargements (/api/leads/export) : jamais interceptés ;
//  - /_next/static/* : cache d'abord (fichiers immuables).
// Historique (v2) — trois stratégies au lieu du network-first uniforme :
//
// 1. /_next/static/*  → CACHE D'ABORD : ces assets portent un hash dans l'URL,
//    ils sont immutables par construction. En réseau lent, plus d'attente.
// 2. GET /api/* → STALE-WHILE-REVALIDATE : on sert le cache immédiatement
//    (le pack contacts s'affiche même en 3G/hors-ligne) et on rafraîchit en
//    arrière-plan. Exception : les requêtes cache:"no-store" (rafraîchissements
//    post-mutation des clients) passent en réseau d'abord — sinon on servirait
//    l'état d'AVANT la mutation qu'on vient de faire.
// 3. Navigations (pages) → RÉSEAU D'ABORD AVEC TIMEOUT 3 s, repli cache :
//    en ligne on voit TOUJOURS la version fraîche (pas de « page de la visite
//    précédente » après un déploiement) ; en réseau lent ou coupé, le cache
//    s'affiche sous 3 s.
// 4. Le reste → RÉSEAU D'ABORD, cache en secours (comportement v1).
//
// Jamais mis en cache : écritures (POST/PATCH/DELETE), cross-origin (Storage
// Supabase : documents volumineux + URLs signées à durée courte), réponses
// > 2 Mo, réponses redirigées (une fiche redirigée vers /login ne doit pas
// écraser la fiche en cache).
const CACHE = "fox-prospect-v4";
const MAX_CACHEABLE_BYTES = 2 * 1024 * 1024;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(response) {
  if (!response || !response.ok || response.status === 206 || response.redirected) return false;
  const len = Number(response.headers.get("content-length") || 0);
  if (len > MAX_CACHEABLE_BYTES) return false;
  return true;
}

async function putInCache(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response);
  } catch {
    // Quota plein ou réponse non clonable : tant pis, on ne casse pas la requête.
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) putInCache(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) putInCache(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return offlineFallback(request);
}

async function networkFirstWithTimeout(request, ms = 3000) {
  try {
    return await Promise.race([
      fetch(request).then((response) => {
        if (isCacheable(response)) putInCache(request, response.clone());
        return response;
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("sw-timeout")), ms)),
    ]);
  } catch {
    // Réseau lent ou coupé : la version en cache vaut mieux qu'une attente.
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) putInCache(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

async function offlineFallback(request) {
  // Page jamais visitée demandée hors-ligne : on retombe sur l'accueil en cache
  // (la liste des prospects avec coordonnées — le « pack contacts »).
  if (request.mode === "navigate") {
    const home = await caches.match("/");
    if (home) return home;
  }
  return new Response("Hors ligne", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Cross-origin (Storage Supabase, CDN externes) : on n'intercepte pas.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Fichiers à télécharger (CSV Sales Chat…) : toujours le serveur, jamais le cache.
  if (url.pathname.startsWith("/api/leads/export")) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
