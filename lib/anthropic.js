// Appels à l'API Anthropic via fetch (pas de SDK : zéro dépendance, build léger).

import { MODEL_SONNET } from "@/lib/constants";

const API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Appelle l'API Anthropic avec retry sur 429/529.
 * - AbortController à 245 s (< 250 s deadline Fluid Compute) pour éviter un
 *   timeout Vercel sans réponse explicite.
 * - 3 tentatives max, back-off plafonné à 20 s (≤ 60 s total de sommeil).
 * - Retourne { text, usage, webSearchCount }.
 */
export async function callClaude({
  system, user, maxTokens = 2000, webSearch = false, maxSearches = 5,
  model = MODEL_SONNET,
}) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };

  if (webSearch) {
    body.tools = [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: maxSearches,
        user_location: { type: "approximate", country: "FR", timezone: "Europe/Paris" },
      },
    ];
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Abort global : 245 s pour laisser 5 s de marge avant le timeout Vercel 250 s.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 245_000);

  // Réessais avec back-off sur 429 (rate-limit) et 529 (surcharge).
  // 3 tentatives max, attente max 20 s, soit ≤ 30 s de sommeil total.
  const maxAttempts = 3;
  let res, detail;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (controller.signal.aborted) {
        throw new Error("Délai maximum dépassé (245 s) — requête interrompue avant timeout Vercel.");
      }
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) break;

      detail = await res.text();
      const retriable = res.status === 429 || res.status === 529;
      if (!retriable || attempt === maxAttempts) {
        throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
      }
      // Respecte retry-after si présent, sinon back-off progressif plafonné à 20 s.
      const ra = Number(res.headers.get("retry-after"));
      const waitMs = (ra > 0 ? ra : Math.min(20, 10 * attempt)) * 1000;
      await sleep(waitMs);
    }
  } finally {
    clearTimeout(abortTimer);
  }

  const data = await res.json();

  const content = data.content || [];
  // Ne conserver que les blocs texte pour la réponse finale.
  const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  // web_search est un outil SERVEUR : ses appels n'apparaissent PAS comme des blocs
  // `tool_use` mais dans usage.server_tool_use.web_search_requests (source exacte
  // et autoritative). Les blocs de contenu sont `server_tool_use`/`web_search_tool_result`.
  const webSearchCount = data.usage?.server_tool_use?.web_search_requests ?? 0;

  return { text, usage: data.usage, webSearchCount };
}

// Le modèle répond parfois avec des fences ```json ou un préambule : on isole le JSON.
// On ne retire les fences qu'en début/fin pour ne jamais altérer le contenu des chaînes.
export function extractJson(text) {
  const cleaned = (text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  // Recherche la première accolade ouvrante et la dernière fermante pour gérer
  // les préambules, mais slice prudemment pour ne pas couper un } dans une valeur.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Pas de JSON trouvé dans la réponse du modèle.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Appel + parsing JSON avec passe de réparation.
 * Si la première réponse n'est pas un JSON valide (préambule, troncature...),
 * on reformate sans web_search — appel court, peu coûteux.
 * Retourne { json, usage, webSearchCount } (usage = total des deux passes si réparation).
 */
export async function callClaudeJson(opts) {
  const first = await callClaude(opts);
  try {
    return { json: extractJson(first.text), usage: first.usage, webSearchCount: first.webSearchCount };
  } catch {
    const repair = await callClaude({
      system:
        "Tu convertis un contenu en JSON strictement valide, conforme au schéma décrit dans les instructions d'origine. Tu ne modifies pas les informations, tu n'ajoutes rien. Réponds UNIQUEMENT avec le JSON.",
      user: `Instructions d'origine :\n${opts.system}\n\nContenu à convertir en JSON valide :\n${first.text}`,
      maxTokens: opts.maxTokens || 2000,
      webSearch: false,
      model: opts.model,
    });
    // Cumul des tokens des deux passes pour une comptabilité exacte.
    const combinedUsage = {
      input_tokens: (first.usage?.input_tokens ?? 0) + (repair.usage?.input_tokens ?? 0),
      output_tokens: (first.usage?.output_tokens ?? 0) + (repair.usage?.output_tokens ?? 0),
    };
    return { json: extractJson(repair.text), usage: combinedUsage, webSearchCount: first.webSearchCount ?? 0 };
  }
}
