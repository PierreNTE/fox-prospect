// Collecteur BOAMP — Marchés publics IT (CPV 48xxx et 72xxx).
// API publique DILA/OpenDataSoft, sans clé, sans authentification.
// Produit des signaux de type "rfp_it" dans company_signals.

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
 * Ingère les signaux BOAMP dans company_signals (nécessite migration-v1.sql).
 * Résout le nom d'acheteur → company.id (best-effort, sans créer de ligne si inconnu).
 * @param {object} supabase — client Supabase
 * @param {{ daysBack?: number }} opts
 * @returns {{ inserted: number, skipped: number }}
 */
export async function ingestBoampSignals(supabase, { daysBack = 30 } = {}) {
  const signals = await fetchBoampSignals({ daysBack });
  let inserted = 0, skipped = 0;

  for (const s of signals) {
    // Cherche le compte par nom (correspondance floue sur accounts.name).
    const { data: matches } = await supabase
      .from("accounts")
      .select("id, company_id")
      .ilike("name", `%${s.acheteur_name.split(" ")[0]}%`)
      .limit(1);

    const account = matches?.[0];
    const companyId = account?.company_id ?? null;

    // On ne crée un signal que si on a un company_id résolu
    // (ou on insère quand même pour les comptes suivis sans SIREN encore résolu).
    if (!companyId && !account) {
      skipped++;
      continue;
    }

    // Déduplication : un même signal BOAMP (même url) ne doit être inséré qu'une fois.
    if (s.source_url) {
      const { count } = await supabase
        .from("company_signals")
        .select("*", { count: "exact", head: true })
        .eq("source_url", s.source_url);
      if ((count ?? 0) > 0) { skipped++; continue; }
    }

    const { error } = await supabase.from("company_signals").insert({
      company_id: companyId,
      type: s.type,
      detail: s.detail,
      observed_at: s.observed_at,
      source_url: s.source_url || null,
      source_verified: false,
      confidence: s.confidence,
      base_weight: s.base_weight,
      status: "nouveau",
    });

    if (error) { skipped++; continue; }
    inserted++;
  }

  return { inserted, skipped, total: signals.length };
}
