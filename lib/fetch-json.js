// Helper de fetch centralisé pour les composants CLIENT uniquement.
//
// Pourquoi : le middleware renvoie un 401 text/plain quand la session expire
// (30 j) — les fetch bruts qui font res.json() plantent alors en SyntaxError,
// laissant l'UI en spinner infini sans jamais ramener vers /login. Ce helper
// uniformise : 401 → redirection login (avec retour à la page courante),
// réponse non-JSON tolérée, erreur toujours lisible pour l'UI.
//
// Usage : const { ok, status, data, error } = await fetchJson(url, options)
// - ok=true  → data contient le JSON de la réponse
// - ok=false → error contient un message affichable (bandeau, toast…)

export async function fetchJson(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "Réseau indisponible. Vérifie ta connexion et réessaie.",
    };
  }

  if (res.status === 401) {
    // Session expirée : on repart au login en mémorisant la page courante
    // pour y revenir après connexion (géré par /login?next=…).
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
    return { ok: false, status: 401, data: null, error: "Session expirée — reconnexion…" };
  }

  // Parse défensif : le corps peut être vide ou du texte brut (middleware,
  // pages d'erreur Vercel) — on ne plante jamais sur un JSON.parse.
  let data = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const fallback =
      res.status === 429
        ? "Limite atteinte (budget ou quota). Réessaie plus tard."
        : `Erreur ${res.status}. Réessaie ; si ça persiste, recharge la page.`;
    return { ok: false, status: res.status, data, error: (data && data.error) || fallback };
  }

  // Certaines routes renvoient 200 avec { error } : on le traite comme un échec.
  if (data && data.error) {
    return { ok: false, status: res.status, data, error: data.error };
  }

  return { ok: true, status: res.status, data, error: null };
}
