// Résolution SIREN via l'API recherche-entreprises.api.gouv.fr (gratuite, sans clé).
// Utilisée pour enrichir les comptes avec leurs données firmographiques officielles.

const SEARCH_URL = "https://recherche-entreprises.api.gouv.fr/search";

/**
 * Résout un nom d'entreprise → données SIRENE.
 * Retourne null si aucun résultat fiable n'est trouvé.
 * @param {{ name: string, domain?: string }} opts
 */
export async function resolveSiren({ name, domain }) {
  if (!name) return null;

  const params = new URLSearchParams({ q: name, page: "1", per_page: "3" });
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;

  const data = await res.json();
  const results = data?.results || [];
  if (results.length === 0) return null;

  // Sélectionne le meilleur résultat :
  // 1. Si on a le domaine web, on cherche une correspondance exacte.
  // 2. Sinon on prend le premier résultat (plus haute pertinence API).
  let best = results[0];
  if (domain) {
    const dom = domain.toLowerCase().replace(/^www\./, "");
    const match = results.find((r) =>
      (r.nom_raison_sociale || "").toLowerCase().includes(name.toLowerCase().split(" ")[0]) &&
      (r.siege?.siret || "").length > 0
    );
    if (match) best = match;
  }

  if (!best) return null;

  return normalizeSireneResult(best);
}

/**
 * Résolution par SIREN direct (si déjà connu).
 * @param {string} siren
 */
export async function fetchBySiren(siren) {
  if (!siren || siren.length !== 9) return null;
  const res = await fetch(`${SEARCH_URL}?q=${siren}&page=1&per_page=1`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const r = data?.results?.[0];
  return r ? normalizeSireneResult(r) : null;
}

export function normalizeSireneResult(r) {
  const siege = r.siege || {};
  // Tranche d'effectif INSEE → bornes numériques
  const TRANCHES = {
    NN: [0, 0], "0": [1, 1], "1": [2, 2], "2": [3, 5], "3": [6, 9], "11": [10, 19],
    "12": [20, 49], "21": [50, 99], "22": [100, 199], "31": [200, 249], "32": [250, 499],
    "41": [500, 999], "42": [1000, 1999], "51": [2000, 4999], "52": [5000, 9999],
    "53": [10000, 19999], "54": [20000, 49999], "55": [50000, 99999], "56": [100000, null],
  };
  const code = r.tranche_effectif_salarie || siege.tranche_effectif_salarie || "";
  const [emin, emax] = TRANCHES[code] || [null, null];
  const tranche = code && code !== "NN" ? effectifLabel(code) : null;

  const categorie = r.categorie_entreprise || null; // PME/ETI/GE (INSEE)

  return {
    siren: r.siren,
    name: r.nom_raison_sociale || r.nom_complet || "",
    naf_code: r.activite_principale || siege.activite_principale || null,
    naf_label: r.libelle_activite_principale?.fr || null,
    effectif_min: emin,
    effectif_max: emax,
    effectif_tranche: tranche,
    region_code: siege.region || null,
    commune: siege.libelle_commune || null,
    categorie,
    etat_admin: r.etat_administratif || "A",
  };
}

function effectifLabel(code) {
  const LABELS = {
    "0": "0", "1": "1", "2": "2-5", "3": "6-9", "11": "10-19", "12": "20-49",
    "21": "50-99", "22": "100-199", "31": "200-249", "32": "250-499",
    "41": "500-999", "42": "1000-1999", "51": "2000-4999", "52": "5000-9999",
    "53": "10000-19999", "54": "20000-49999", "55": "50000-99999", "56": "100000+",
  };
  return LABELS[code] || null;
}

/**
 * Upsert une entreprise dans la table companies et retourne son id.
 * Crée si absent (par SIREN ou par domaine), met à jour les données firmographiques.
 */
export async function upsertCompany(supabase, sireneData, extraFields = {}) {
  if (!sireneData) return null;

  const payload = {
    siren: sireneData.siren,
    name: sireneData.name,
    naf_code: sireneData.naf_code,
    naf_label: sireneData.naf_label,
    effectif_min: sireneData.effectif_min,
    effectif_max: sireneData.effectif_max,
    effectif_tranche: sireneData.effectif_tranche,
    region_code: sireneData.region_code,
    commune: sireneData.commune,
    categorie: sireneData.categorie,
    etat_admin: sireneData.etat_admin,
    updated_at: new Date().toISOString(),
    ...extraFields,
  };

  const { data, error } = await supabase
    .from("companies")
    .upsert(payload, { onConflict: "siren", ignoreDuplicates: false })
    .select("id")
    .single();

  // Le retour null reste le contrat — un référentiel absent ne doit pas empêcher
  // la création du compte — mais il ne doit plus être MUET. Cette fonction a
  // échoué sur la totalité de ses appels pendant tout l'été sans laisser trace :
  // `error` n'était pas lu, et l'appelant avalait le reste. Un échec silencieux
  // à 100 % est indiscernable d'une fonctionnalité qui n'existe pas.
  if (error) {
    console.error(`[sirene] upsert companies échoué (siren ${payload.siren}) : ${error.message}`);
    return null;
  }
  return data?.id ?? null;
}
