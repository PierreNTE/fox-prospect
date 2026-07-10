// Collecteur BOAMP — Marchés publics IT (CPV 48xxx et 72xxx).
// API publique DILA/OpenDataSoft, sans clé, sans authentification.
// Produit des signaux de type "rfp_it" dans company_signals.

import { ingestSignals } from "@/lib/signals";

const BOAMP_API = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";

// Codes CPV ciblés (préfixes) : logiciels + services IT + sécurité + cloud.
const CPV_IT_PREFIXES = ["48", "72", "3512500", "6431"];

// Filtres ODSQL : avis de marché récents sur ces familles CPV.
function buildWhere(daysBack = 30) {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const cpvFilter = CPV_IT_PREFIXES.map((p) => `cpv like "${p}%"`).join(" OR ");
  return `(${cpvFilter}) AND dateparution >= date'${since}'`;
}

/**
 * Récupère les dernières annonces BOAMP IT.
 * @param {{ daysBack?: number, limit?: number }} opts
 * @returns {Promise<Array>} Liste de signaux normalisés.
 */
export async function fetchBoampSignals({ daysBack = 30, limit = 50 } = {}) {
  const params = new URLSearchParams({
    where: buildWhere(daysBack),
    select: "objet,acheteur,dateparution,cpv,url,famille,nature",
    order_by: "dateparution desc",
    limit: String(limit),
    offset: "0",
  });

  const res = await fetch(`${BOAMP_API}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`BOAMP API ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  }

  const data = await res.json();
  return (data.results || []).map(normalizeBoampRecord).filter(Boolean);
}

function normalizeBoampRecord(r) {
  const objet = r.objet || "";
  const acheteur = r.acheteur?.nom || r.acheteur || "";
  const date = (r.dateparution || "").slice(0, 10); // ISO YYYY-MM-DD
  const url = r.url || "";
  const cpv = Array.isArray(r.cpv) ? r.cpv.join(", ") : (r.cpv || "");

  if (!acheteur || !objet) return null;

  return {
    type: "rfp_it",
    acheteur_name: typeof acheteur === "string" ? acheteur : acheteur.nom || String(acheteur),
    detail: objet.length > 200 ? objet.slice(0, 200) + "…" : objet,
    observed_at: date || new Date().toISOString().slice(0, 10),
    source_url: url,
    cpv,
    base_weight: 40,
    confidence: 1.0,
  };
}

/**
 * Ingère les signaux BOAMP dans company_signals — en lot via lib/signals.js
 * (3 requêtes au total au lieu de 2-3 par signal).
 * @param {object} supabase — client Supabase
 * @param {{ daysBack?: number }} opts
 * @returns {{ inserted: number, skipped: number, total: number }}
 */
export async function ingestBoampSignals(supabase, { daysBack = 30 } = {}) {
  const signals = await fetchBoampSignals({ daysBack });
  return ingestSignals(
    supabase,
    signals.map((s) => ({ ...s, company_name: s.acheteur_name }))
  );
}
