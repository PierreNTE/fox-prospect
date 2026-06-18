import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { upsertCompany } from "@/lib/sirene";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/accounts/import-sirene
// Inflow de NOUVEAUX COMPTES cibles depuis l'API officielle recherche-entreprises
// (INSEE/SIRENE, gratuite, sans clé), filtrés sur l'ICP. Contrairement à
// /api/companies/import (qui ne remplit que le référentiel `companies`), ici on
// crée de vrais `accounts` — l'entité sur laquelle tournent l'analyse, le
// scraping et la qualification. C'est le levier pour tenir 200-300 prospects/MOIS
// (≈40-60 nouvelles sociétés/mois), sinon le scraping re-moud les mêmes comptes.
//
// auto_watch=false : les comptes importés n'entrent PAS d'office dans la veille
// LLM (sinon 50 comptes froids × ~0,10 € grignoteraient le budget mensuel). Tu
// scrapes/analyses ceux que tu veux ; bascule la veille par compte si besoin.

const SEARCH_URL = "https://recherche-entreprises.api.gouv.fr/search";

// Acheteurs IT stratégiques (cyber/cloud/infra, soumis NIS2/DORA/HDS) — défaut
// si l'ICP ne précise pas de NAF. Préfixes à 2 chiffres.
const DEFAULT_NAF_PREFIXES = [
  "62", "63", "64", "65", "66", "86", "87", "88", "84", "35", "49", "50", "51", "52", "72", "38", "39",
];

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
  const supabase = getSupabase();

  // ICP par défaut depuis les réglages (l'utilisateur peut surcharger via body).
  const { data: settings } = await supabase.from("settings").select("icp").eq("id", 1).single();
  const icp = settings?.icp || {};

  const categories = body.categories || ["ETI", "GE"];
  // Préfixes NAF cibles : body > ICP > défaut. On normalise sur 2 chiffres.
  const nafSource = body.naf_prefixes || icp.naf_inclus || DEFAULT_NAF_PREFIXES;
  const nafPrefixes = new Set((nafSource || []).map((c) => String(c).replace(/\D/g, "").slice(0, 2)).filter(Boolean));
  const effectifMin = body.effectif_min ?? icp.effectif_min ?? null;
  const effectifMax = body.effectif_max ?? icp.effectif_max ?? null;
  const departements = body.departements || null; // array de codes (optionnel)

  const target = Math.min(Number(body.limit) || 25, 50); // nouveaux comptes voulus / appel
  const startPage = Math.max(1, Number(body.page) || 1);
  const maxPagesPerCall = 8; // borne le temps de réponse (8 × 25 = 200 scannés max)

  // Dédup : noms de comptes déjà en base (l'index unique est sur lower(name)).
  const { data: existing } = await supabase.from("accounts").select("name");
  const known = new Set((existing || []).map((a) => (a.name || "").toLowerCase().trim()));

  const toCreate = [];     // { sireneData } retenus
  let scanned = 0, skippedIcp = 0, duplicates = 0;
  let page = startPage;
  let totalResults = 0;
  let apiHasMore = true;

  for (let i = 0; i < maxPagesPerCall && toCreate.length < target && apiHasMore; i++, page++) {
    const params = new URLSearchParams({
      categorie_entreprise: categories.join(","),
      etat_administratif: "A",
      page: String(page),
      per_page: "25",
    });
    if (departements) params.set("departement", departements.join(","));

    let apiData;
    try {
      const res = await fetch(`${SEARCH_URL}?${params}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        if (i === 0) return NextResponse.json({ error: `API SIRENE : ${res.status}` }, { status: 502 });
        break; // pages suivantes : on s'arrête proprement avec ce qu'on a
      }
      apiData = await res.json();
    } catch (e) {
      if (i === 0) return NextResponse.json({ error: `Timeout ou erreur réseau : ${e.message}` }, { status: 502 });
      break;
    }

    const results = apiData?.results || [];
    totalResults = apiData?.total_results || totalResults;
    apiHasMore = page * 25 < totalResults;

    for (const r of results) {
      scanned++;
      const sd = parseSireneResult(r);
      if (!sd.siren || !sd.name) { skippedIcp++; continue; }

      // Filtre ICP : NAF cible.
      const prefix = (sd.naf_code || "").slice(0, 2);
      if (nafPrefixes.size && !nafPrefixes.has(prefix)) { skippedIcp++; continue; }

      // Filtre ICP : effectif (si la tranche est connue).
      if (effectifMin != null && sd.effectif_max != null && sd.effectif_max < effectifMin) { skippedIcp++; continue; }
      if (effectifMax != null && sd.effectif_min != null && sd.effectif_min > effectifMax) { skippedIcp++; continue; }

      const key = sd.name.toLowerCase().trim();
      if (known.has(key)) { duplicates++; continue; }
      known.add(key); // évite les doublons intra-lot
      toCreate.push(sd);
      if (toCreate.length >= target) break;
    }
  }

  // Création : upsert companies (référentiel) + insert accounts liés.
  let imported = 0;
  const sample = [];
  for (const sd of toCreate) {
    const companyId = await upsertCompany(supabase, sd).catch(() => null);
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        name: sd.name,
        sector: sd.naf_label || "",
        company_id: companyId,
        auto_watch: false,
      })
      .select("id, name")
      .single();
    if (!error && data) {
      imported++;
      if (sample.length < 8) sample.push(data.name);
    } else {
      duplicates++; // collision possible sur l'index unique lower(name)
    }
  }

  return NextResponse.json({
    imported,
    duplicates,
    skipped_icp: skippedIcp,
    scanned,
    sample,
    next_page: page,
    has_more: apiHasMore,
    total_results: totalResults,
  });
}
