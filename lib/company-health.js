// Contrôle « santé » d'une société avant de l'appeler :
//   1. résolution du SIREN (API Recherche d'entreprises, gratuite, sans clé),
//   2. état administratif (active / fermée),
//   3. procédures collectives publiées au BODACC (API DILA, gratuite, sans clé).
//
// Les fonctions de rapprochement et de classement sont pures (testées) ;
// seules checkCompanyHealth / fetch* touchent le réseau.
//
// Société fermée ou introuvable : on cherche si elle continue sous une autre
// identité (absorption, changement de nom, rachat) — lib/company-successor.js.
import { findSuccessor } from "@/lib/company-successor";

const SEARCH_URL = "https://recherche-entreprises.api.gouv.fr/search";
const BODACC_URL =
  "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";

// Mots sans valeur discriminante pour le rapprochement de noms.
const STOP = new Set([
  "SA", "SAS", "SASU", "SARL", "EURL", "SCI", "SNC", "SCOP", "SEM", "GIE", "SE",
  "SELARL", "SELAS", "SELASU", "SELAFA", "SCM", "SCP", "SCEA", "EARL",
  "STE", "SOCIETE", "STE.", "ET", "DE", "DU", "DES", "LA", "LE", "LES", "L", "D",
  "AND", "THE", "GROUPE", "GROUP", "FRANCE", "CIE", "COMPAGNIE",
]);

export function normalizeName(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// Pluriel naïf : « PLASTIQUES » doit retrouver « PLASTIQUE ».
const stem = (t) => (t.length > 4 ? t.replace(/S$/, "") : t);

export function tokens(s) {
  return normalizeName(s).split(" ").filter((t) => t && !STOP.has(t)).map(stem);
}

/** Part des mots du nom cherché retrouvés dans le candidat (0..1). */
export function nameScore(query, candidate) {
  const q = tokens(query);
  if (!q.length) return 0;
  const c = new Set(tokens(candidate));
  // Noms collés (« HautAnjou », « DATAFILIATION ») : on compare aussi la forme compacte.
  const compact = [...c].join("");
  const hit = q.filter((t) => c.has(t) || (t.length >= 4 && compact.includes(t))).length;
  return hit / q.length;
}

/**
 * Choisit le meilleur résultat SIRENE pour un nom Salesforce.
 * @param {string} query  nom nettoyé
 * @param {string} hint   indice entre parenthèses : commune ou n° de département
 * @param {object[]} results  résultats bruts de l'API
 */
export function pickBestMatch(query, hint, results) {
  if (!results?.length) return null;
  const h = normalizeName(hint);
  const isDept = /^\d{2,3}$|^2[AB]$/.test(h);

  const scored = results.map((r, i) => {
    const names = [r.nom_complet, r.nom_raison_sociale, r.sigle].filter(Boolean);
    let score = Math.max(...names.map((n) => nameScore(query, n)), 0);
    const siege = r.siege || {};
    const etabs = [siege, ...(r.matching_etablissements || [])];
    if (h) {
      const loc = etabs.some((e) =>
        isDept
          ? String(e.departement || "") === h || String(e.code_postal || "").startsWith(h)
          : normalizeName(e.libelle_commune).includes(h)
      );
      if (loc) score += 0.25;
    }
    if (r.etat_administratif === "A") score += 0.05; // à égalité, préférer la société vivante
    score -= i * 0.01; // à égalité, garder l'ordre de pertinence de l'API
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const confidence = best.score >= 0.85 ? "sure" : best.score >= 0.5 ? "probable" : "faible";
  return { result: best.r, score: Number(best.score.toFixed(2)), confidence };
}

// ── BODACC ────────────────────────────────────────────────────────────

function parseJugement(j) {
  if (!j) return {};
  if (typeof j === "object") return j;
  try {
    return JSON.parse(j);
  } catch {
    return { nature: String(j) };
  }
}

/**
 * Classe la situation à partir des annonces BODACC d'une société.
 * Retourne { procedure, label, date, nature } — procedure ∈
 *   "liquidation" | "redressement" | "sauvegarde" | "plan" | "cloturee" | null
 * Une procédure ancienne (> 36 mois) close par un plan n'est plus un signal.
 */
export function classifyBodacc(records, now = new Date()) {
  const coll = (records || [])
    .filter((r) => r.familleavis === "collective" || /collective/i.test(r.familleavis_lib || ""))
    .map((r) => {
      const j = parseJugement(r.jugement);
      return {
        date: j.date || r.dateparution || null,
        parution: r.dateparution || null,
        nature: String(j.nature || j.famille || r.typeavis_lib || "").trim(),
      };
    })
    .sort((a, b) => String(b.parution || b.date).localeCompare(String(a.parution || a.date)));

  if (!coll.length) return { procedure: null, label: "", date: null, nature: "" };
  const last = coll[0];
  const n = normalizeName(last.nature);
  const ageMonths = last.parution
    ? (now - new Date(last.parution)) / (1000 * 60 * 60 * 24 * 30.4)
    : 0;

  let procedure;
  let label;
  if (/CLOTURE/.test(n) && /EXTINCTION/.test(n)) {
    return { procedure: null, label: "", date: null, nature: "" };
  } else if (/CLOTURE/.test(n) && /INSUFFISANCE|LIQUIDATION/.test(n)) {
    procedure = "cloturee"; label = "Liquidation clôturée";
  } else if (/LIQUIDATION/.test(n)) {
    procedure = "liquidation"; label = "Liquidation judiciaire";
  } else if (/PLAN/.test(n)) {
    procedure = "plan"; label = "Plan de continuation / sauvegarde";
  } else if (/REDRESSEMENT/.test(n)) {
    procedure = "redressement"; label = "Redressement judiciaire";
  } else if (/SAUVEGARDE/.test(n)) {
    procedure = "sauvegarde"; label = "Procédure de sauvegarde";
  } else {
    procedure = "autre"; label = last.nature || "Procédure collective";
  }

  if ((procedure === "plan" || procedure === "autre") && ageMonths > 36) {
    return { procedure: null, label: "", date: null, nature: "" };
  }
  return { procedure, label, date: last.date || last.parution, nature: last.nature };
}

/**
 * Verdict final affiché dans l'app.
 * status ∈ "active" | "vigilance" | "fermee" | "introuvable"
 */
export function healthVerdict({ match, etat, bodacc }) {
  if (!match) return { status: "introuvable", label: "Société introuvable dans SIRENE — à vérifier" };
  if (etat === "C") return { status: "fermee", label: "Société fermée (cessée au répertoire SIRENE)" };
  if (bodacc?.procedure === "liquidation" || bodacc?.procedure === "cloturee") {
    return { status: "fermee", label: bodacc.label };
  }
  if (bodacc?.procedure) {
    return { status: "vigilance", label: bodacc.label };
  }
  if (match.confidence === "faible") {
    return { status: "introuvable", label: "Rapprochement incertain — vérifie le SIREN" };
  }
  return { status: "active", label: "Active, aucune procédure collective publiée" };
}

// ── Réseau ────────────────────────────────────────────────────────────

async function getJson(url, timeout = 10_000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeout),
    });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error("HTTP 429");
}

export async function searchSirene(query, hint) {
  const params = new URLSearchParams({ q: query, page: "1", per_page: "8" });
  const h = normalizeName(hint);
  if (/^\d{2,3}$|^2[AB]$/.test(h)) params.set("departement", h);
  const data = await getJson(`${SEARCH_URL}?${params}`);
  return data?.results || [];
}

export async function fetchBodacc(siren) {
  const spaced = siren.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
  const query = (where) =>
    getJson(`${BODACC_URL}?${new URLSearchParams({
      where,
      order_by: "dateparution desc",
      limit: "30",
      select: "dateparution,familleavis,familleavis_lib,typeavis_lib,jugement,registre",
    })}`).then((d) => d?.results || []);

  // 1. Filtre exact sur le champ registre (multivalué : « 123456789 », « 123 456 789 »).
  const exact = await query(`registre="${siren}" OR registre="${spaced}"`);
  if (exact.length) return exact;
  // 2. Filet : recherche plein texte, puis on ne garde que les annonces de CE SIREN.
  const text = await query(`"${siren}"`);
  return text.filter((r) => {
    const reg = [].concat(r.registre || []).map((v) => String(v).replace(/\s/g, ""));
    return reg.includes(siren);
  });
}

/** Annonces BODACC d'un SIREN, tous champs (textes des radiations, modifications…). */
export async function fetchBodaccFull(siren) {
  const spaced = siren.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
  const data = await getJson(`${BODACC_URL}?${new URLSearchParams({
    where: `registre="${siren}" OR registre="${spaced}"`,
    order_by: "dateparution desc",
    limit: "30",
  })}`);
  return data?.results || [];
}

/** Annonces BODACC qui citent un nom (ancienne dénomination, précédent propriétaire…). */
export async function searchBodaccText(name) {
  const q = String(name || "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return [];
  const data = await getJson(`${BODACC_URL}?${new URLSearchParams({
    where: `"${q}"`,
    order_by: "dateparution desc",
    limit: "30",
  })}`);
  return data?.results || [];
}

/** Fiche SIRENE d'un SIREN précis. */
export async function lookupSiren(siren) {
  const data = await getJson(`${SEARCH_URL}?${new URLSearchParams({ q: siren, page: "1", per_page: "3" })}`);
  return (data?.results || []).find((r) => r.siren === siren) || null;
}

const SUCCESSOR_NET = {
  fetchRecords: fetchBodaccFull,
  searchText: searchBodaccText,
  lookupSiren,
  searchName: (name) => searchSirene(name, ""),
  classify: async (siren) => classifyBodacc(await fetchBodacc(siren)),
};

/**
 * Applique un successeur trouvé au résultat du contrôle.
 * Piste forte (BODACC) et successeur sain : le compte redevient appelable, sous
 * l'identité du successeur. Piste faible (homonyme) : simple signalement.
 */
export function applySuccessor(check, successor) {
  if (!successor) return check;
  const predecessor = check.match
    ? { siren: check.match.siren, name: check.sirene?.nom_complet || null, label: check.verdict.label }
    : { siren: null, name: null, label: check.verdict.label };
  const info = {
    siren: successor.siren, name: successor.name, reason: successor.reason,
    reason_label: successor.reason_label, date: successor.date, evidence: successor.evidence,
    source: successor.source, confidence: successor.confidence,
  };

  if (successor.confidence === "forte") {
    const match = { siren: successor.siren, score: 1, confidence: "probable" };
    const base = healthVerdict({ match, etat: "A", bodacc: successor.bodacc });
    const when = successor.date ? ` (${String(successor.date).slice(0, 7)})` : "";
    return {
      match,
      sirene: successor.sirene,
      bodacc: successor.bodacc,
      successor: info,
      predecessor,
      verdict: {
        status: base.status,
        label: `Continue sous « ${successor.name} » — ${successor.reason_label}${when}. `
          + (base.status === "active" ? "À appeler sous ce nom, et à renommer dans Salesforce." : base.label),
      },
    };
  }
  return {
    ...check,
    successor: info,
    verdict: { ...check.verdict, label: `${check.verdict.label} · Piste : « ${successor.name} » (${successor.reason_label}), à vérifier` },
  };
}

/**
 * Contrôle complet d'une société Salesforce.
 * @param {{ query: string, hint?: string }} name  sortie de cleanCompanyName
 */
export async function checkCompanyHealth({ query, hint = "" }) {
  let results = await searchSirene(query, hint);
  // Département en indice mais rien trouvé : on retente sans le filtre.
  if (!results.length && hint) results = await searchSirene(query, "");
  let match = pickBestMatch(query, hint, results);
  // « ENSEIGNE/RAISON SOCIALE » : Salesforce colle parfois
  // deux noms (enseigne / raison sociale). Si le nom complet échoue, chaque partie.
  if ((!match || match.confidence === "faible") && /\s*\/\s*/.test(query)) {
    for (const part of query.split(/\s*\/\s*/).map((x) => x.trim()).filter((x) => x.length >= 3)) {
      const r2 = await searchSirene(part, hint).catch(() => []);
      const m2 = pickBestMatch(part, hint, r2);
      if (m2 && (!match || m2.score > match.score)) { match = m2; results = r2; query = part; }
      if (match?.confidence === "sure") break;
    }
  }
  if (!match) {
    const none = { match: null, sirene: null, bodacc: null, verdict: healthVerdict({}) };
    // Introuvable sous ce nom : peut-être renommée ou absorbée (BODACC plein texte).
    const successor = await findSuccessor({ query, closed: null, results }, SUCCESSOR_NET).catch(() => null);
    return applySuccessor(none, successor);
  }

  const r = match.result;
  let bodacc = null;
  let bodaccError = null;
  try {
    bodacc = classifyBodacc(await fetchBodacc(r.siren));
  } catch (e) {
    bodaccError = e.message;
  }
  const verdict = healthVerdict({ match, etat: r.etat_administratif, bodacc });
  if (bodaccError && verdict.status === "active") {
    verdict.label = "Active au SIRENE (BODACC non consulté — à revérifier)";
  }
  const check = {
    match: { siren: r.siren, score: match.score, confidence: match.confidence },
    sirene: r,
    bodacc,
    verdict,
  };
  // Fermée, liquidée ou nom incertain : chercher si l'activité continue ailleurs.
  if (verdict.status === "fermee" || verdict.status === "introuvable") {
    const successor = await findSuccessor({ query, closed: r, results }, SUCCESSOR_NET).catch(() => null);
    return applySuccessor(check, successor);
  }
  return check;
}
