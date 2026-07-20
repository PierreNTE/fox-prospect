"use client";

import { useEffect, useState } from "react";

// Bannière hors-ligne + précache du « pack contacts ».
// - Au montage (différé), on demande /api/prospects : le service worker
//   (stale-while-revalidate) le garde en cache → la liste avec emails et
//   téléphones reste consultable hors-ligne même sans visite récente.
// - Hors-ligne, on affiche la date des données en cache (en-tête Date de la
//   réponse mise en cache) : l'utilisateur sait sur quoi il s'appuie avant
//   de composer un numéro.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    // Précache différé du pack contacts (après le rendu initial).
    const t = setTimeout(() => {
      fetch("/api/prospects").catch(() => {});
    }, 3000);

    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!offline || !("caches" in window)) {
      setCachedAt(null);
      return;
    }
    caches
      .match("/api/prospects")
      .then((res) => {
        const d = res?.headers?.get("date");
        setCachedAt(d ? new Date(d) : null);
      })
      .catch(() => setCachedAt(null));
  }, [offline]);

  if (!offline) return null;

  const when = cachedAt
    ? `données du ${cachedAt.toLocaleDateString("fr-FR")} à ${cachedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : "données en cache";

  return (
    <div
      role="status"
      style={{
        padding: "6px 16px",
        fontSize: 12.5,
        fontWeight: 600,
        textAlign: "center",
        background: "#7C5500",
        color: "#fff",
      }}
    >
      Hors ligne — {when}. Les modifications ne seront pas enregistrées.
    </div>
  );
}
