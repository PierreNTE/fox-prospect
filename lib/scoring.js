// Scoring déterministe à 5 sous-scores — zéro LLM, recalculable à tout moment.
// Remplace le fit_score opaque (entier 0-100 non reproductible) par des sous-scores
// explicables dont les valeurs dérivent directement des données en base.

import { NEWS_IMPACT, NEWS_IMPACT_DEFAULT } from "@/lib/constants";

// ── Demi-vies de décroissance par type de signal (en mois) ──────────────────
// Plus la demi-vie est courte, plus le signal perd de sa valeur rapidement.
const HALF_LIVES = {
  rfp_it: 2,          // appel d'offres IT : fenêtre courte, très urgent
  incident: 3,        // cyberattaque, panne : réaction immédiate attendue
  recrutement: 4,     // recrutement IT actif : signal chaud 3-4 mois
  levee: 12,          // levée de fonds : effets IT à 3-6 mois
  nomination: 9,      // nouveau DSI/RSSI : revue fournisseurs dans 6-12 mois
  projet: 8,          // projet SI annoncé : cycle long
  prise_de_parole: 6, // interview, conférence : visibilité
  reglementaire: 18,  // NIS2, DORA, HDS : deadline lointaine mais croissante
  autre: 6,
};

// ── Poids de base par type (quand base_weight n'est pas en base) ─────────────
const BASE_WEIGHTS = {
  rfp_it: 40,
  recrutement: 35,
  nomination: 35,
  incident: 28,
  levee: 28,
  projet: 20,
  reglementaire: 18,
  prise_de_parole: 10,
  autre: 5,
};

// ── Codes NAF à fort potentiel (NIS2/DORA/HDS/réglementaire IT) ─────────────
const HIGH_VALUE_NAF_PREFIXES = ["64", "65", "86", "35", "49", "50", "51", "52", "84", "87", "88"];

// ─────────────────────────────────────────────────────────────────────────────

function parseSignalDate(s) {
  const raw = (s?.date || s?.observed_at || "").trim();
  if (!raw) return null;
  let m;
  // ISO date complète
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // YYYY-MM
  m = raw.match(/^(\d{4})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, 15);
  // YYYY seul
  m = raw.match(/^(\d{4})$/);
  if (m) return new Date(+m[1], 6, 1);
  // "mars 2024", "avril 2024"…
  const MONTHS = {
    janvier: 0, février: 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
    juillet: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10,
    décembre: 11, decembre: 11,
  };
  m = raw.toLowerCase().match(/([a-zéûôàèî]+)\s+(\d{4})/);
  if (m && MONTHS[m[1]] !== undefined) return new Date(+m[2], MONTHS[m[1]], 15);
  return null;
}

function signalFreshness(signal, now) {
  const date = parseSignalDate(signal);
  if (!date) return 0.5;
  const ageMs = now - date.getTime();
  // Signal dans le futur (ex : deadline réglementaire) → fraîcheur maximale + boost urgence.
  if (ageMs < 0) return 1.0;
  const ageMois = ageMs / (1000 * 60 * 60 * 24 * 30.44);
  const H = HALF_LIVES[signal.type] || 6;
  return Math.exp(-(Math.LN2 / H) * ageMois);
}

// Score d'urgence (poids 35%) — agrège les signaux avec décroissance temporelle.
function computeUrgencyScore(signals, now) {
  if (!signals || signals.length === 0) return 0;
  const contributions = signals.map((s) => {
    const base = s.base_weight || BASE_WEIGHTS[s.type] || 5;
    const conf = s.confidence !== undefined ? Number(s.confidence) : 1.0;
    return base * signalFreshness(s, now) * conf;
  });
  contributions.sort((a, b) => b - a);
  // Agrégation top-3 avec poids dégressifs (évite la saturation par accumulation).
  const raw = (contributions[0] || 0) + 0.5 * (contributions[1] || 0) + 0.25 * (contributions[2] || 0);
  // Normalisation : score de 30 pts bruts → 100.
  return Math.min(100, Math.round((raw / 30) * 100));
}

// Score de potentiel business (poids 25%) — firmographique, sans LLM.
function computeBusinessScore({ effectif_min, effectif_max, effectif_tranche, naf_code, categorie } = {}) {
  let base = 50; // inconnu → défaut médian
  const eff = effectif_min || effectif_max;
  if (eff !== undefined && eff !== null) {
    if (eff < 50) base = 20;
    else if (eff < 250) base = 45;
    else if (eff < 1000) base = 70;
    else if (eff < 5000) base = 88;
    else base = 100;
  } else if (effectif_tranche) {
    const MAP = {
      "1-9": 10, "10-19": 20, "20-49": 30, "50-99": 45, "100-199": 55,
      "200-249": 60, "250-499": 70, "500-999": 80, "1000-1999": 85,
      "2000-4999": 90, "5000+": 100,
    };
    base = MAP[effectif_tranche] ?? 50;
  } else {
    const CAT = { TPE: 15, PME: 50, ETI: 75, GE: 90 };
    base = CAT[categorie] ?? 50;
  }
  const nis2Bonus = HIGH_VALUE_NAF_PREFIXES.includes((naf_code || "").slice(0, 2)) ? 10 : 0;
  return Math.min(100, Math.round(base + nis2Bonus));
}

// Score d'accessibilité du contact (poids 18%).
function computeAccessibilityScore(contact) {
  if (!contact) return 30; // inconnu → défaut bas
  if (contact.do_not_contact) return 0; // opposition RGPD → inaccessible

  let score = 0;
  const conf = contact.email_confidence || "";
  if (conf === "haute") score += 30;
  else if (conf === "moyenne") score += 20;
  else if (conf === "basse") score += 10;
  else if (conf === "déduit") score += 8;
  else if (contact.email) score += 15; // email présent sans niveau de confiance

  if (contact.phone) score += 20;
  if (contact.linkedin_url) score += 15;

  // Niveau hiérarchique : opérationnel (RSSI adjoint) > N-1 > DSI grand groupe.
  const role = (contact.role || "").toLowerCase();
  if (/adjoint|assistant|junior/i.test(role)) score += 25;
  else if (/\brssi\b|ciso|chief security/i.test(role)) score += 20;
  else if (/responsable|manager|head of/i.test(role)) score += 18;
  else if (/\bdsi\b|directeur.*si|chief information/i.test(role)) score += 12;

  return Math.min(100, Math.round(score));
}

// Score global avec gate d'urgence : sans urgence, le score est plafonné à ×0,5.
function computeGlobalScore({ urgency, business, accessibility }) {
  const gate = 0.5 + 0.5 * (urgency / 100);
  const weighted = 0.35 * urgency + 0.25 * business + 0.18 * accessibility;
  return Math.min(100, Math.max(0, Math.round(weighted * gate)));
}

/**
 * Point d'entrée principal.
 * @param {{ prospect?: object, signals?: object[], firmographics?: object, now?: number }} opts
 * @returns {{ global_score, urgency_score, business_score, accessibility_score, it_maturity_score, breakdown, weights_version }}
 */
export function computeScores({ prospect = {}, signals = [], firmographics = {}, now = Date.now() } = {}) {
  const urgency = computeUrgencyScore(signals, now);
  const business = computeBusinessScore(firmographics);
  const accessibility = computeAccessibilityScore(prospect);
  const global = computeGlobalScore({ urgency, business, accessibility });

  const topSignal = signals.length > 0
    ? { type: signals[0].type, detail: signals[0].detail, date: signals[0].date || signals[0].observed_at }
    : null;

  return {
    global_score: global,
    urgency_score: urgency,
    business_score: business,
    accessibility_score: accessibility,
    it_maturity_score: null, // extraction structurée via LLM — V1.1
    breakdown: {
      signals_count: signals.length,
      top_signal: topSignal,
      firmographics_source: firmographics?.siren ? "sirene" : "unknown",
      email_confidence: prospect?.email_confidence || null,
      gate: +(0.5 + 0.5 * (urgency / 100)).toFixed(2),
    },
    weights_version: "v1",
  };
}

/**
 * Priorité d'un signal de veille, sur 100 — déterministe, sans LLM.
 *
 * Le tri par date, qui était l'ordre d'affichage de la veille, place un article
 * de blog publié ce matin devant un appel d'offres de la semaine dernière. Or
 * la question du commercial n'est pas « qu'est-ce qui est récent » mais « par
 * quoi je commence ». D'où quatre facteurs, tous déjà en base :
 *
 *   impact du type × fraîcheur (demi-vie par type) × fiabilité du rattachement
 *   × pertinence jugée
 *
 * Les deux derniers facteurs sont des MINORATIONS, jamais des bonus : un signal
 * mal rattaché ou jugé peu pertinent recule, aucun ne peut dépasser un signal
 * certain de même impact. Un signal non jugé (relevance null) n'est pas pénalisé
 * — l'absence de jugement n'est pas un mauvais jugement.
 *
 * @param {{type, observed_at, match_method, match_confidence, relevance, base_weight}} signal
 */
export function signalPriority(signal, now = Date.now()) {
  if (!signal) return 0;
  const base = signal.base_weight || BASE_WEIGHTS[signal.type] || 5;
  const fraicheur = signalFreshness(signal, now);

  // Fiabilité du rattachement : une similarité de nom à 78 % pèse 78 % d'un
  // rattachement certain. Les méthodes sûres valent 1 même sans score.
  const METHODES_SURES = ["source", "lei", "siren", "registre", "domaine", "manuel"];
  const conf = METHODES_SURES.includes(signal.match_method)
    ? 1
    : Number(signal.match_confidence ?? 0.7);

  const pertinence = signal.relevance === null || signal.relevance === undefined
    ? 1
    : Number(signal.relevance);

  const brut = base * fraicheur * Math.min(1, Math.max(0, conf)) * Math.min(1, Math.max(0, pertinence));
  // 40 points bruts = 100 : un appel d'offres du jour, parfaitement rattaché.
  return Math.min(100, Math.round((brut / 40) * 100));
}

/**
 * Commodité : calcule uniquement le heat score d'un compte à partir de ses
 * signaux JSONB existants (accounts.signals). Compatible avec l'ancien schéma.
 */
export function computeAccountHeat(account) {
  const signals = Array.isArray(account.signals) ? account.signals : [];
  return computeUrgencyScore(signals, Date.now());
}

/**
 * Chaleur d'un compte pour la LISTE (QW2). Combine les signaux structurés (s'ils
 * existent) et la fraîcheur × impact des actualités — toujours peuplées par
 * l'analyse compte, donc source fiable même quand `signals` est vide.
 * Renvoie des scalaires légers, calculés côté serveur (le jsonb lourd ne
 * traverse jamais jusqu'au client).
 * @returns {{ heat: number, news_count: number, last_news_date: string|null }}
 */
export function computeAccountHeatFull(account, now = Date.now()) {
  const news = Array.isArray(account.news) ? account.news : [];
  let newsRaw = 0;
  let lastMs = null;
  for (const n of news) {
    const d = parseSignalDate({ date: n?.date });
    if (d && (lastMs === null || d.getTime() > lastMs)) lastMs = d.getTime();
    // Catégorie absente ou hors référentiel → impact plancher, jamais ignorée.
    const impact = NEWS_IMPACT[n?.category] ?? NEWS_IMPACT_DEFAULT;
    // Fraîcheur : demi-vie 6 mois. Actu sans date → fraîcheur médiane basse.
    const fresh = d ? Math.exp(-(Math.LN2 / 6) * ((now - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44))) : 0.4;
    newsRaw += impact * Math.max(0, fresh);
  }
  const newsHeat = Math.min(100, Math.round((newsRaw / 40) * 100));
  const signalHeat = computeUrgencyScore(Array.isArray(account.signals) ? account.signals : [], now);
  return {
    heat: Math.max(newsHeat, signalHeat),
    news_count: news.length,
    last_news_date: lastMs !== null ? new Date(lastMs).toISOString().slice(0, 10) : null,
  };
}
