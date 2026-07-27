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

// ── Fiche compte : actualités à impact métier / IT uniquement ────────────────
// Filtre appliqué au prompt ET à la validation : une actu hors de ces
// catégories (marketing, sponsoring, produit grand public) est écartée.
// Mesuré en base : le modèle produisait régulièrement « organisation »,
// « partenariat » et « reglementaire », absents de cette liste — donc rabattus
// sur un défaut arbitraire qui faussait le score de chaleur. Ces trois valeurs
// sont légitimes : on les accueille plutôt que de les écraser. « autre » est le
// refuge explicite des actus non classables (impact plancher, jamais exclues).
export const NEWS_CATEGORIES = Object.freeze([
  "nomination", "fusion_acquisition", "investissement", "recrutement",
  "projet", "transformation", "cloud", "ia", "cybersecurite",
  "erp_crm", "infrastructure", "data", "resultats",
  "organisation", "partenariat", "reglementaire", "autre",
]);

export const NEWS_CATEGORY_LABELS = Object.freeze({
  nomination: "Nomination",
  fusion_acquisition: "Fusion / acquisition",
  investissement: "Investissement",
  recrutement: "Recrutement",
  projet: "Projet",
  transformation: "Transformation",
  cloud: "Cloud",
  ia: "IA",
  cybersecurite: "Cybersécurité",
  erp_crm: "ERP / CRM",
  infrastructure: "Infrastructure",
  data: "Data",
  resultats: "Résultats",
  organisation: "Organisation",
  partenariat: "Partenariat",
  reglementaire: "Réglementaire",
  autre: "Autre",
});

// Poids d'une actualité dans la chaleur d'un compte et dans le tri de la veille.
// Source de vérité UNIQUE (lib/scoring.js et lib/data.js s'y réfèrent) : deux
// tables divergentes donnaient deux classements différents pour la même actu.
// Une catégorie absente vaut NEWS_IMPACT_DEFAULT — jamais 0, jamais exclue.
export const NEWS_IMPACT = Object.freeze({
  nomination: 30, cybersecurite: 30, fusion_acquisition: 28, projet: 26,
  investissement: 24, recrutement: 22, transformation: 22, reglementaire: 20,
  cloud: 20, erp_crm: 20, partenariat: 18, infrastructure: 18,
  organisation: 16, data: 16, ia: 16, resultats: 12, autre: 8,
});

export const NEWS_IMPACT_DEFAULT = 8;

// Niveau hiérarchique d'un contact de l'organigramme (lecture rapide :
// qui décide / qui influence / qui exécute).
export const ORG_LEVELS = Object.freeze(["direction", "management", "operationnel"]);
export const ORG_LEVEL_LABELS = Object.freeze({
  direction: "Direction",
  management: "Management",
  operationnel: "Opérationnel",
});
export const EMAIL_CONFIDENCE = Object.freeze(["haute", "moyenne", "basse", "déduit"]);
export const LINKEDIN_CONFIDENCE = Object.freeze(["haute", "moyenne", "basse"]);
// Doit rester aligné sur la contrainte CHECK de company_signals (migration v12).
// `concurrence` y manquait : lib/schemas.js valide les sorties LLM contre cette
// liste et rabat l'inconnu sur « autre », si bien qu'un signal concurrentiel
// produit par l'analyse de compte était réécrit en « autre » avant insertion.
export const SIGNAL_TYPES = Object.freeze([
  "recrutement", "levee", "projet", "incident", "nomination",
  "reglementaire", "prise_de_parole", "rfp_it", "concurrence", "autre",
]);

// Modèles Anthropic utilisés dans l'app.
export const MODEL_SONNET = "claude-sonnet-4-6";
export const MODEL_HAIKU = "claude-haiku-4-5-20251001";

// Tarifs estimés en euros (mis à jour manuellement si les tarifs changent).
// Source : https://www.anthropic.com/pricing — convertis à ~0,93 EUR/USD.
//
// ⚠️ Ces valeurs sont recopiées dans QUATRE fichiers — veille/config.py,
// scripts/eval.mjs et scripts/contact-sources/discover.py portent la même
// table. Les corriger partout ou pas du tout : une seule table fausse suffit à
// fausser le kill-switch, qui ne sait pas qu'il se trompe.
//
// Le tarif Haiku a porté 0,25 / 1,25 jusqu'au 2026-07-27 — celui de Claude 3.5
// Haiku, alors que le modèle appelé est haiku-4-5 (voir MODEL_HAIKU), facturé
// quatre fois plus cher. Conséquence mesurée sur juillet 2026 : 4,34 € de
// dépense réelle absente d'ai_runs, soit très exactement le trou constaté au
// rapprochement avec la console et longtemps imputé à des scripts non
// journalisés. Un compteur qui applique un tarif est aussi faux que son tarif.
export const ANTHROPIC_TARIF = {
  sonnet_input_per_m_eur: 2.8,       // ~$3/M
  sonnet_output_per_m_eur: 14.0,     // ~$15/M
  haiku_input_per_m_eur: 0.93,       // $1/M  (haiku-4-5)
  haiku_output_per_m_eur: 4.65,      // $5/M  (haiku-4-5)
  web_search_per_k_eur: 9.3,         // ~$10/1k
};

// Lire les variables d'environnement avec leurs valeurs par défaut.
// À utiliser côté serveur uniquement.
export function getEnvConfig() {
  return {
    dailyCap: Number(process.env.DAILY_RESEARCH_CAP) || 50,
    // 2 par défaut (et non 4) : chaque recherche web coûte ~€0,019 en frais
    // d'appel, et surtout rapatrie du contexte facturé à l'entrée.
    //
    // Mesuré le 2026-07-27 sur les 160 prospects qualifiés en juillet, tarifs
    // corrigés : **~€0,093 par qualification**, soit ~160 prospects dans 15 €/mois.
    // La cible de €0,045 affichée ici jusqu'alors était fausse d'un facteur 2.
    //
    // Le poste dominant n'est pas le NOMBRE de recherches mais le VOLUME de
    // jetons qu'elles ramènent : 26 500 jetons d'entrée par appel d'extraction
    // en moyenne. Descendre ce réglage sous 2 ne rendrait donc presque rien.
    maxSearches: Number(process.env.RESEARCH_MAX_SEARCHES) || 2,
    freshnessTtlDays: Number(process.env.FRESHNESS_TTL_DAYS) || 14,
  };
}
