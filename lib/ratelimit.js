// Rate-limit en mémoire par fenêtre fixe — même approche assumée que le
// compteur du login : les instances serverless sont éphémères, donc la limite
// est « par instance », suffisante pour décourager l'abus (un cookie volé ne
// peut plus vider le budget IA en rafale). À l'échelle SaaS : Upstash/Redis.
//
// Compatible Edge (middleware) : aucune dépendance Node.

const buckets = new Map();

/**
 * @param {string} key — ex. `${ip}:llm`
 * @param {{ max?: number, windowMs?: number }} opts
 * @returns {{ limited: boolean, remaining: number }}
 */
export function rateLimit(key, { max = 60, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now >= entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Nettoyage opportuniste : évite la croissance infinie de la Map.
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    return { limited: false, remaining: max - 1 };
  }

  entry.count++;
  return { limited: entry.count > max, remaining: Math.max(0, max - entry.count) };
}
