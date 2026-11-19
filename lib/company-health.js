// Contrôle « santé » d'une société avant de l'appeler :
//   1. résolution du SIREN (API Recherche d'entreprises, gratuite, sans clé),
//   2. état administratif (active / fermée),
//   3. procédures collectives publiées au BODACC (API DILA, gratuite, sans clé).
//
// Les fonctions de rapprochement et de classement sont pures (testées) ;
// seules checkCompanyHealth / fetch* touchent le réseau.

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

function tokens(s) {
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

/**
 * Contrôle complet d'une société Salesforce.
 * @param {{ query: string, hint?: string }} name  sortie de cleanCompanyName
 */
export async function checkCompanyHealth({ query, hint = "" }) {
  let results = await searchSirene(query, hint);
  // Département en indice mais rien trouvé : on retente sans le filtre.
  if (!results.length && hint) results = await searchSirene(query, "");
  const match = pickBestMatch(query, hint, results);
  if (!match) return { match: null, sirene: null, bodacc: null, verdict: healthVerdict({}) };

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
  return {
    match: { siren: r.siren, score: match.score, confidence: match.confidence },
    sirene: r,
    bodacc,
    verdict,
  };
}
