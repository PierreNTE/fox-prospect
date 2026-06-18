// QW5 — source de vérité pour tous les enums et valeurs magiques de l'app.
// N'importer que les valeurs nécessaires (pas de default export) pour éviter
// d'alourdir les bundles edge.

export const PROSPECT_STATUS = Object.freeze({
  NOUVEAU: "nouveau",
  RECHERCHE: "recherché",
  CONTACTE: "contacté",
  OPT_OUT: "opt-out",
});

export const RELIABILITY = Object.freeze(["verifie", "partiel", "non_verifie"]);
export const ROLE_CONFIDENCE = Object.freeze(["certain", "probable", "incertain"]);
export const EMAIL_CONFIDENCE = Object.freeze(["haute", "moyenne", "basse", "déduit"]);
export const LINKEDIN_CONFIDENCE = Object.freeze(["haute", "moyenne", "basse"]);
export const SIGNAL_TYPES = Object.freeze([
  "recrutement", "levee", "projet", "incident", "nomination",
  "reglementaire", "prise_de_parole", "rfp_it", "autre",
]);

// Modèles Anthropic utilisés dans l'app.
export const MODEL_SONNET = "claude-sonnet-4-6";
export const MODEL_HAIKU = "claude-haiku-4-5-20251001";

// Tarifs estimés en euros (mis à jour manuellement si les tarifs changent).
// Source : https://www.anthropic.com/pricing — convertis à ~0,93 EUR/USD.
export const ANTHROPIC_TARIF = {
  sonnet_input_per_m_eur: 2.8,       // ~$3/M
  sonnet_output_per_m_eur: 14.0,     // ~$15/M
  haiku_input_per_m_eur: 0.25,       // ~$0.25/M
  haiku_output_per_m_eur: 1.25,      // ~$1.25/M
  web_search_per_k_eur: 9.3,         // ~$10/1k
};

// Lire les variables d'environnement avec leurs valeurs par défaut.
// À utiliser côté serveur uniquement.
export function getEnvConfig() {
  return {
    dailyCap: Number(process.env.DAILY_RESEARCH_CAP) || 50,
    // 2 par défaut (et non 4) : le web_search domine le coût d'une qualif
    // (~€0,028 sur €0,07). À 2 recherches → ~€0,045/qualif → ~330 prospects
    // qualifiables dans un budget de 15 €/mois. Override possible si besoin.
    maxSearches: Number(process.env.RESEARCH_MAX_SEARCHES) || 2,
    freshnessTtlDays: Number(process.env.FRESHNESS_TTL_DAYS) || 14,
  };
}
