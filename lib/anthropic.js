// Appels à l'API Anthropic via fetch (pas de SDK : zéro dépendance, build léger).

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

export async function callClaude({ system, user, maxTokens = 2000, webSearch = false, maxSearches = 5 }) {
  const body = {
    model: MODEL,
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
        user_location: {
          type: "approximate",
          country: "FR",
          timezone: "Europe/Paris",
        },
      },
    ];
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();

  // La réponse peut mélanger blocs texte, recherches et résultats : on ne garde que le texte.
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return { text, usage: data.usage };
}

// Le modèle répond parfois avec des fences ```json ou un préambule : on isole le JSON.
// On ne retire les fences qu'en début/fin pour ne jamais altérer le contenu des chaînes.
export function extractJson(text) {
  const cleaned = (text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Pas de JSON trouvé dans la réponse du modèle.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Appel + parsing JSON avec une passe de réparation : si la première réponse
// n'est pas un JSON valide (préambule, troncature...), on demande au modèle de
// la reformater — appel court, sans web search, donc rapide et peu coûteux.
// Évite de perdre une recherche web déjà payée pour un simple problème de format.
export async function callClaudeJson(opts) {
  const first = await callClaude(opts);
  try {
    return { json: extractJson(first.text), usage: first.usage };
  } catch {
    const repair = await callClaude({
      system:
        "Tu convertis un contenu en JSON strictement valide, conforme au schéma décrit dans les instructions d'origine. Tu ne modifies pas les informations, tu n'ajoutes rien. Réponds UNIQUEMENT avec le JSON.",
      user: `Instructions d'origine :\n${opts.system}\n\nContenu à convertir en JSON valide :\n${first.text}`,
      maxTokens: opts.maxTokens || 2000,
      webSearch: false,
    });
    return { json: extractJson(repair.text), usage: repair.usage };
  }
}
