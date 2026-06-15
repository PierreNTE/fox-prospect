import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { upsertCompany } from "@/lib/sirene";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Codes NAF cibles : IT, finance, assurance, santé, énergie, transport, administration.
// Acheteurs stratégiques de cybersécurité / cloud / infra IT soumis à NIS2/DORA/HDS.
const TARGET_NAF_PREFIXES = new Set([
  "62", "63", "64", "65", "66",  // tech/fintech/finance/assurance
  "86", "87", "88",               // santé
  "84",                            // administration publique (NIS2)
  "35",                            // énergie (infrastructure critique)
  "49", "50", "51", "52",         // transport
  "72",                            // recherche scientifique (DSI)
  "38", "39",                      // gestion déchets (infra critique)
]);

const SEARCH_URL = "https://recherche-entreprises.api.gouv.fr/search";

const EFFECTIF_TRANCHES = {
  NN: [0, 0], "0": [1, 1], "1": [2, 2], "2": [3, 5], "3": [6, 9], "11": [10, 19],
  "12": [20, 49], "21": [50, 99], "22": [100, 199], "31": [200, 249], "32": [250, 499],
  "41": [500, 999], "42": [1000, 1999], "51": [2000, 4999], "52": [5000, 9999],
  "53": [10000, 19999], "54": [20000, 49999], "55": [50000, 99999], "56": [100000, null],
};

function parseSireneResult(r) {
  const siege = r.siege || {};
  const naf = r.activite_principale || siege.activite_principale || "";
  const code = r.tranche_effectif_salarie || siege.tranche_effectif_salarie || "";
  const [emin, emax] = EFFECTIF_TRANCHES[code] || [null, null];
  return {
    siren: r.siren,
    name: r.nom_raison_sociale || r.nom_complet || "",
    naf_code: naf,
    naf_label: r.libelle_activite_principale?.fr || null,
    effectif_min: emin,
    effectif_max: emax,
    effectif_tranche: code && code !== "NN" ? code : null,
    region_code: siege.region || null,
    commune: siege.libelle_commune || null,
    categorie: r.categorie_entreprise || null,
    etat_admin: r.etat_administratif || "A",
  };
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const {
    categories = ["ETI", "GE"],
    naf_prefix = null,
    page = 1,
    per_page = 25,
  } = body;

  const supabase = getSupabase();

  const params = new URLSearchParams({
    categorie_entreprise: categories.join(","),
    etat_administratif: "A",
    page: String(page),
    per_page: String(Math.min(Number(per_page), 25)),
  });
  if (naf_prefix) params.set("activite_principale", naf_prefix);

  let apiData;
  try {
    const res = await fetch(`${SEARCH_URL}?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return NextResponse.json({ error: `API SIRENE : ${res.status}` }, { status: 502 });
    apiData = await res.json();
  } catch (e) {
    return NextResponse.json({ error: `Timeout ou erreur réseau : ${e.message}` }, { status: 502 });
  }

  const results = apiData?.results || [];
  const totalResults = apiData?.total_results || 0;

  let imported = 0;
  let skipped = 0;

  for (const r of results) {
    const naf = r.activite_principale || r.siege?.activite_principale || "";
    const nafPrefix = naf.slice(0, 2);
    // Si aucun préfixe demandé, filtre sur la liste cible.
    if (!naf_prefix && !TARGET_NAF_PREFIXES.has(nafPrefix)) {
      skipped++;
      continue;
    }

    const sireneData = parseSireneResult(r);
    if (!sireneData.siren || !sireneData.name) { skipped++; continue; }

    const id = await upsertCompany(supabase, sireneData).catch(() => null);
    if (id) imported++;
    else skipped++;
  }

  const pageSize = Math.min(Number(per_page), 25);
  return NextResponse.json({
    imported,
    skipped,
    page,
    per_page: pageSize,
    total_results: totalResults,
    has_more: page * pageSize < totalResults,
    next_page: page + 1,
  });
}

// GET — nombre de sociétés déjà en base.
export async function GET() {
  const supabase = getSupabase();
  const { count } = await supabase
    .from("companies")
    .select("*", { count: "exact", head: true });
  return NextResponse.json({ total: count ?? 0 });
}
