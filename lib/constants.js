// QW5 — source de vérité pour tous les enums et valeurs magiques de l'app.
// N'importer que les valeurs nécessaires (pas de default export) pour éviter
// d'alourdir les bundles edge.

// Funnel commercial simplifié (P2). Le statut n'encode QUE la situation
// commerciale — l'état de recherche IA vit dans prospects.researched_at, et
// l'opposition RGPD dans prospects.do_not_contact (drapeau séparé).
export const PROSPECT_STATUS = Object.freeze({
  NON_CONTACTE: "non_contacte",
  CONTACTE: "contacte",
  EN_COURS: "en_cours",
  INTERESSE: "interesse",
  REFUSE: "refuse",
  CLIENT: "client",
});

// Ordre d'affichage du funnel (du plus froid au plus chaud).
export const STATUS_ORDER = Object.freeze([
  "non_contacte", "contacte", "en_cours", "interesse", "refuse", "client",
]);

export const STATUS_LABELS = Object.freeze({
  non_contacte: "Non contacté",
  contacte: "Contacté",
  en_cours: "En cours",
  interesse: "Intéressé",
  refuse: "Refusé",
  client: "Client",
});

// Libellé tolérant : toute valeur inconnue (ancienne donnée, valeur custom)
// est affichée capitalisée plutôt que vide.
export function statusLabel(s) {
  if (STATUS_LABELS[s]) return STATUS_LABELS[s];
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Qualité de la donnée de contact (P2 #4) ─────────────────────────────────
// Dérivée (pas de colonne) de la confiance email + présence d'un téléphone.
// Un téléphone scrapé est une coordonnée réelle → « à confirmer » et non
// « non fiable » : on appelle pour vérifier.
export const DATA_QUALITY_LABELS = Object.freeze({
  verifie: "Données vérifiées",
  a_confirmer: "À confirmer",
  non_fiable: "Non fiable",
});

export function dataQualityLevel({ email = "", phone = "", email_confidence = "" } = {}) {
  const conf = (email_confidence || "").toLowerCase();
  const hasPhone = !!String(phone || "").trim();
  const hasEmail = !!String(email || "").trim();

  // Aucune coordonnée → inexploitable.
  if (!hasPhone && !hasEmail) return "non_fiable";
  // Email validé à confiance haute → donnée vérifiée.
  if (conf === "haute") return "verifie";
  // Email douteux et aucun téléphone de repli → non fiable.
  if (!hasPhone && (conf === "basse" || conf === "déduit" || conf === "deduit")) return "non_fiable";
  // Reste (téléphone à valider, email moyen…) → à confirmer.
  return "a_confirmer";
}

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
