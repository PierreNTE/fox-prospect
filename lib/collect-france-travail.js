// Collecteur France Travail (ex-Pôle Emploi) — offres IT/cyber/cloud.
// Nécessite des credentials OAuth2 obtenus sur https://francetravail.io/
// Variables : FRANCE_TRAVAIL_CLIENT_ID, FRANCE_TRAVAIL_CLIENT_SECRET
// Produit des signaux de type "recrutement" dans company_signals.

import { ingestSignals } from "@/lib/signals";

const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

// Domaines ROME ciblés (IT, cyber, cloud, data, management SI).
const ROME_CODES = ["M1802", "M1801", "M1805", "M1804", "M1803", "M1106"];

// Mots-clés qui identifient les postes décideurs IT (signaux d'or).
const HIGH_VALUE_KEYWORDS = ["RSSI", "DSI", "CISO", "cloud", "cybersécurité", "cybersecurite", "SOC", "SIEM", "NIS2", "DORA"];

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;

  const clientId = process.env.FRANCE_TRAVAIL_CLIENT_ID;
  const clientSecret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "api_offresdemploiv2 o2dsoffre",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

/**
 * Recherche des offres IT récentes sur France Travail.
 * @param {{ romeCode?: string, motsCles?: string, range?: string }} opts
 * @returns {Promise<Array>} Offres normalisées.
 */
async function searchOffres({ romeCode, motsCles, range = "0-99" } = {}) {
  const token = await getAccessToken();
  if (!token) return [];

  const params = new URLSearchParams({ range });
  if (romeCode) params.set("codeROME", romeCode);
  if (motsCles) params.set("motsCles", motsCles);
  // Offres publiées dans les 30 derniers jours.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  params.set("minCreationDate", since + "T00:00:00Z");

  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];

  const data = await res.json();
  return data.resultats || [];
}

function isHighValue(offre) {
  const text = `${offre.intitule || ""} ${offre.description || ""}`.toLowerCase();
  return HIGH_VALUE_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

function normalizeOffre(offre) {
  const company = offre.entreprise?.nom || "";
  if (!company) return null;
  return {
    type: "recrutement",
    company_name: company,
    detail: `Recrutement : ${offre.intitule || "poste IT"} (${offre.lieuTravail?.libelle || "France"})`,
    observed_at: (offre.dateCreation || new Date().toISOString()).slice(0, 10),
    source_url: offre.origineOffre?.urlOrigine || null,
    base_weight: isHighValue(offre) ? 35 : 20,
    confidence: 1.0,
    rome: offre.romeCode || null,
  };
}

/**
 * Récupère les offres IT stratégiques de toutes les cibles ROME + mots-clés.
 */
export async function fetchFranceTravailSignals() {
  if (!process.env.FRANCE_TRAVAIL_CLIENT_ID) {
    return { signals: [], skipped: true, reason: "FRANCE_TRAVAIL_CLIENT_ID absent" };
  }

  const allOffres = [];
  // Passe 1 : mots-clés décideurs
  for (const kw of ["RSSI", "DSI", "cybersécurité", "cloud architect", "CISO"]) {
    const offres = await searchOffres({ motsCles: kw });
    allOffres.push(...offres);
  }
  // Passe 2 : codes ROME IT
  for (const code of ROME_CODES) {
    const offres = await searchOffres({ romeCode: code });
    allOffres.push(...offres);
  }

  // Déduplique par id d'offre.
  const seen = new Set();
  const unique = allOffres.filter((o) => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });

  return { signals: unique.map(normalizeOffre).filter(Boolean) };
}

/**
 * Ingère les signaux France Travail dans company_signals — en lot via
 * lib/signals.js (3 requêtes au total au lieu de 2-3 par signal).
 */
export async function ingestFranceTravailSignals(supabase) {
  const { signals, skipped, reason } = await fetchFranceTravailSignals();
  if (skipped) return { inserted: 0, skipped: 0, skippedReason: reason };
  return ingestSignals(supabase, signals);
}
