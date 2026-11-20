// « Radiée » ne veut pas toujours dire « disparue ».
//
// Une société fermée au SIRENE (ou introuvable sous son nom Salesforce) vit
// souvent encore sous une autre identité :
//   - fusion-absorption / TUP : la société est radiée, l'absorbante continue ;
//   - changement de dénomination : même activité, nouveau nom ;
//   - rachat du fonds / plan de cession : le repreneur exploite l'activité.
// Le BODACC publie ces opérations. On cherche ici le successeur :
//   1. dans les annonces de la société fermée (SIREN cités à côté de
//      « fusion », « absorption », « cession »…),
//   2. dans les annonces qui citent le nom Salesforce (« ancienne
//      dénomination », « précédent propriétaire »…),
//   3. à défaut, une société active homonyme dans SIRENE (simple piste).
// Puis on vérifie que le successeur est actif au SIRENE.
//
// Fonctions pures testées ; le réseau est injecté (fetch* en paramètres).
import { nameScore, normalizeName, tokens } from "@/lib/company-health";

/** Clé de Luhn : un SIREN valide la respecte (filtre montants et numéros parasites). */
export function isValidSiren(s) {
  if (!/^\d{9}$/.test(s)) return false;
  if (s === "356000000") return true; // La Poste, exception historique
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(s[8 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** SIREN cités dans un texte (« 123 456 789 », « 123456789 », RCS…), hors montants. */
export function extractSirens(text) {
  const out = new Set();
  const re = /(?<!\d)(\d{3})[ . ]?(\d{3})[ . ]?(\d{3})(?![\d])/g;
  let m;
  while ((m = re.exec(text || ""))) {
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    const after = text.slice(re.lastIndex, re.lastIndex + 12);
    if (/capital|montant|€|euros?/i.test(before) || /^\s*(€|euros?|eur\b)/i.test(after)) continue;
    const s = m[1] + m[2] + m[3];
    if (isValidSiren(s)) out.add(s);
  }
  return [...out];
}

// Champs techniques à ne pas lire comme du texte d'annonce.
const SKIP_KEYS = /^(id|url|pdf|publicationavis_facette|region|numerodepartement|cp)$/i;

function flatten(v, out) {
  if (v == null) return;
  if (typeof v === "string") {
    const t = v.trim();
    if ((t.startsWith("{") || t.startsWith("[")) && t.length > 2) {
      try { flatten(JSON.parse(t), out); return; } catch { /* texte brut */ }
    }
    out.push(t);
  } else if (Array.isArray(v)) v.forEach((x) => flatten(x, out));
  else if (typeof v === "object") {
    for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.test(k)) flatten(x, out);
  } else out.push(String(v));
}

/** Texte lisible d'une annonce BODACC, quels que soient ses champs (JSON imbriqués compris). */
export function recordText(record) {
  const out = [];
  flatten(record, out);
  return out.join(" · ").replace(/\s+/g, " ");
}

export const LINK_REASONS = [
  { key: "fusion", label: "fusion-absorption", re: /fusion|absorb|absorption/i },
  { key: "tup", label: "transmission universelle de patrimoine", re: /transmission universelle|\bT\.?U\.?P\b|dissolution sans liquidation/i },
  { key: "rename", label: "changement de dénomination", re: /ancienne?s? d[ée]nomination|anciennement|nouvelle d[ée]nomination|changement de (la )?d[ée]nomination|modification de (la )?d[ée]nomination/i },
  { key: "cession", label: "rachat / cession", re: /plan de cession|cessionnaire|pr[ée]c[ée]dents? propri[ée]taires?|pr[ée]c[ée]dents? exploitants?|vente (du|de) fonds|cession (du|de) fonds|achat (du|d'un) fonds/i },
];

// « absorbée par la société X », « au profit de la société X », « cessionnaire : X »…
const NAME_AFTER = /(?:absorb[ée]e?s?\s+par|absorption\s+par|au\s+profit\s+de|fusion(?:-absorption)?\s+(?:avec|par)|transmise?\s+(?:à|a)|cessionnaire\s*:?|repreneur\s*:?|reprise\s+par)\s+(?:la\s+)?(?:soci[ée]t[ée]\s+|sas\s+|sarl\s+|sa\s+)?[«"]?\s*([A-Z0-9][A-Za-z0-9&'’.\- ]{2,60}?)(?=\s*(?:[,;(»"]|\s-\s|\s+(?:RCS|SIREN|immatricul|dont|au capital|sise|si[èe]ge|soci[ée]t[ée]\b))|\.\s|$)/i;

/** Noms de successeurs cités sans SIREN dans les annonces de la société fermée. */
export function successorNames(ownRecords) {
  const out = [];
  for (const r of ownRecords || []) {
    const text = recordText(r);
    const reason = linkReason(text);
    if (!reason || reason.key === "rename") continue;
    const m = NAME_AFTER.exec(text);
    const name = m?.[1]?.replace(/\s+/g, " ").trim();
    if (name && name.length >= 3 && !out.some((x) => x.name === name)) {
      out.push({ name, reason: reason.key, reason_label: reason.label, date: r.dateparution || null, evidence: snippet(text, NAME_AFTER) });
    }
  }
  return out.slice(0, 3);
}

export function linkReason(text) {
  return LINK_REASONS.find((r) => r.re.test(text || "")) || null;
}

const sirensOf = (record) =>
  [].concat(record.registre || []).map((v) => String(v).replace(/\s/g, "")).filter((s) => /^\d{9}$/.test(s));

function snippet(text, re) {
  const m = re.exec(text);
  if (!m) return text.slice(0, 220);
  const start = Math.max(0, m.index - 90);
  return `${start ? "…" : ""}${text.slice(start, m.index + 150)}…`;
}

/**
 * Pistes de successeur à partir des annonces BODACC.
 * @param {object[]} ownRecords    annonces de la société fermée
 * @param {object[]} nameRecords   annonces trouvées en plein texte sur le nom Salesforce
 * @param {{ ownSiren?: string, oldName: string }} ctx
 * @returns {{ siren, reason, reason_label, date, evidence, source }[]} les plus récentes d'abord
 */
export function successorCandidates(ownRecords, nameRecords, { ownSiren, oldName }) {
  const found = new Map();
  const add = (c) => {
    if (!c.siren || c.siren === ownSiren) return;
    const prev = found.get(c.siren);
    if (!prev || String(c.date || "") > String(prev.date || "")) found.set(c.siren, c);
  };

  // 1. Annonces de la société fermée : SIREN cités à côté d'un mot de liaison.
  //    « Précédent propriétaire » y désigne l'AVANT (son propre achat), pas l'après.
  for (const r of ownRecords || []) {
    const text = recordText(r);
    let reason = linkReason(text);
    if (reason?.key === "cession" && !/plan de cession|cessionnaire/i.test(text)) reason = null;
    if (!reason) continue;
    for (const siren of extractSirens(text)) {
      add({ siren, reason: reason.key, reason_label: reason.label, date: r.dateparution || null,
        evidence: snippet(text, reason.re), source: "annonce de la société" });
    }
  }

  // 2. Annonces qui citent le nom Salesforce : la société qui publie est le successeur.
  for (const r of nameRecords || []) {
    const text = recordText(r);
    const reason = linkReason(text);
    if (!reason) continue;
    // Le nom doit y figurer d'un bloc (mots dans l'ordre), pas en mots épars.
    const phrase = tokens(oldName).join(" ");
    if (!phrase || !` ${tokens(text).join(" ")} `.includes(` ${phrase} `)) continue;
    const publisher = sirensOf(r);
    // L'annonce de la société fermée elle-même ne désigne pas de successeur.
    const others = publisher.filter((s) => s !== ownSiren);
    const targets = others.length ? others : extractSirens(text).filter((s) => s !== ownSiren);
    for (const siren of targets.slice(0, 2)) {
      add({ siren, reason: reason.key, reason_label: reason.label, date: r.dateparution || null,
        evidence: snippet(text, reason.re), source: "annonce citant l'ancien nom" });
    }
  }

  return [...found.values()].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

/** Sociétés actives au nom quasi identique dans les résultats SIRENE (piste faible). */
export function activeHomonyms(query, results, excludeSiren) {
  return (results || [])
    .filter((r) => r.etat_administratif === "A" && r.siren !== excludeSiren)
    .filter((r) => Math.max(...[r.nom_complet, r.nom_raison_sociale, r.sigle].filter(Boolean)
      .map((n) => nameScore(query, n)), 0) >= 0.85)
    .slice(0, 2);
}

/**
 * Recherche complète du successeur. Réseau injecté :
 * @param {{ query, closed?: object, results?: object[] }} input
 * @param {{ fetchRecords(siren), searchText(name), lookupSiren(siren), classify(siren) }} net
 * @returns {null | { siren, name, sirene, bodacc, reason, reason_label, date, evidence, source, confidence }}
 */
export async function findSuccessor({ query, closed = null, results = [] }, net) {
  const ownSiren = closed?.siren || null;
  const [ownRecords, nameRecords] = await Promise.all([
    ownSiren ? net.fetchRecords(ownSiren).catch(() => []) : [],
    query && normalizeName(query).length >= 4 ? net.searchText(query).catch(() => []) : [],
  ]);

  for (const c of successorCandidates(ownRecords, nameRecords, { ownSiren, oldName: query }).slice(0, 3)) {
    const r = await net.lookupSiren(c.siren).catch(() => null);
    if (!r || r.etat_administratif !== "A") continue;
    const bodacc = await net.classify(c.siren).catch(() => null);
    return { ...c, name: r.nom_complet || r.nom_raison_sociale || c.siren, sirene: r, bodacc, confidence: "forte" };
  }

  // Successeur cité par son nom, sans SIREN : on le cherche au SIRENE.
  if (net.searchName) {
    for (const c of successorNames(ownRecords)) {
      const found = await net.searchName(c.name).catch(() => []);
      const best = (found || [])
        .filter((r) => r.etat_administratif === "A" && r.siren !== ownSiren)
        .map((r) => ({ r, score: Math.max(...[r.nom_complet, r.nom_raison_sociale, r.sigle].filter(Boolean).map((n) => nameScore(c.name, n)), 0) }))
        .sort((a, b) => b.score - a.score)[0];
      if (!best || best.score < 0.85) continue;
      const bodacc = await net.classify(best.r.siren).catch(() => null);
      return {
        siren: best.r.siren, name: best.r.nom_complet || c.name, sirene: best.r, bodacc,
        reason: c.reason, reason_label: c.reason_label, date: c.date, evidence: c.evidence,
        source: "annonce de la société (nom du successeur)", confidence: "forte",
      };
    }
  }

  const homonym = activeHomonyms(query, results, ownSiren)[0];
  if (homonym) {
    return {
      siren: homonym.siren, name: homonym.nom_complet, sirene: homonym, bodacc: null,
      reason: "homonyme", reason_label: "société active au nom proche", date: homonym.date_creation || null,
      evidence: "", source: "SIRENE", confidence: "a_verifier",
    };
  }
  return null;
}
