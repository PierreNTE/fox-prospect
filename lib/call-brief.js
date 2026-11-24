// Brief d'appel automatique — calculé à la lecture pour chaque lead, sans IA
// ni coût : verdict, anomalies à corriger, actualité, qui appeler, question
// d'ouverture et note Salesforce prête à coller. Fonctions pures, testées.
//
// Données utilisées : santé société (SIRENE, BODACC), collecte web, contacts,
// suivi d'appel, et les contrôles de la fiche Salesforce collée
// (sf_paste_flags). Rien n'est stocké : le brief est toujours à jour.
import { whoToCall, pickEmail } from "@/lib/who-to-call";
import { isPublicBuyer } from "@/lib/boamp";

export const ANOMALIES = {
  ADDR_MISMATCH: { label: "Adresse Salesforce différente de SIRENE", sf: true },
  EMAIL_DOMAIN_TYPO: { label: "Domaine email erroné ou sans serveur mail", sf: true },
  NOTE_STALE: { label: "Note Salesforce de plus de 2 ans", sf: true },
  PHONE_AREA_MISMATCH: { label: "Indicatif sans rapport avec le département", sf: true },
  LOW_POTENTIAL: { label: "Holding sans salarié : faible potentiel", sf: true },
  SHARED_DOMAIN: { label: "Domaine email partagé (réseau, fédération)", sf: false },
  HQ_DECIDES: { label: "Établissement secondaire : décision au siège", sf: false },
  NO_VALID_PHONE: { label: "Aucun numéro valide", sf: false },
};

export const VERDICTS = {
  appeler: { label: "À appeler", color: "success" },
  verifier: { label: "À vérifier", color: "warning" },
  faible: { label: "Faible potentiel", color: "subtle" },
  cloturer: { label: "À clôturer", color: "danger" },
};

// ── Outils ──────────────────────────────────────────────────────────────

/** Distance d'édition (Levenshtein), pour repérer un domaine mal saisi. */
export function levenshtein(a, b) {
  a = String(a || ""); b = String(b || "");
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Département d'un code postal (« 2A »/« 2B » pour la Corse, « 97x » outre-mer). */
export function deptOf(cp) {
  const c = String(cp || "").replace(/\s/g, "");
  if (!/^\d{5}$/.test(c)) return null;
  if (c.startsWith("20")) return Number(c) < 20200 ? "2A" : "2B";
  if (c.startsWith("97") || c.startsWith("98")) return c.slice(0, 3);
  return c.slice(0, 2);
}

// Zones des numéros fixes (ARCEP) : 01 Île-de-France, 02 Nord-Ouest (+ Réunion,
// Mayotte), 03 Nord-Est, 04 Sud-Est, 05 Sud-Ouest (+ Antilles, Guyane).
const ZONE = {
  "01": "75 77 78 91 92 93 94 95",
  "02": "14 18 22 27 28 29 35 36 37 41 44 45 49 50 53 56 61 72 76 85 974 976",
  "03": "02 08 10 21 25 39 51 52 54 55 57 58 59 60 62 67 68 70 71 80 88 89 90",
  "04": "01 03 04 05 06 07 11 13 15 26 2A 2B 30 34 38 42 43 48 63 66 69 73 74 83 84",
  "05": "09 12 16 17 19 23 24 31 32 33 40 46 47 64 65 79 81 82 86 87 971 972 973",
};
const DEPT_ZONE = Object.fromEntries(Object.entries(ZONE).flatMap(([z, ds]) => ds.split(" ").map((d) => [d, z])));

/** L'indicatif d'un fixe correspond-il au département ? null si non applicable. */
export function phoneMatchesDept(phone, dept) {
  const d = String(phone || "").replace(/\D/g, "").replace(/^33/, "0");
  if (d.length !== 10 || !/^0[1-5]/.test(d) || !dept || !DEPT_ZONE[dept]) return null;
  return d.slice(0, 2) === DEPT_ZONE[dept];
}

const hostOf = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].toLowerCase();
export const officialDomain = (l) => hostOf(l.domain || l.website || l.web_intel?.site?.url || "");
const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|live|orange|wanadoo|free|sfr|laposte|neuf|bbox|icloud|aol)\./;

/** Domaines email utilisés par plusieurs leads de SIREN différents (réseaux, fédérations). */
export function sharedDomains(leads) {
  const by = new Map();
  for (const l of leads) {
    const e = l.email?.email || l.found_email || "";
    const d = e.split("@")[1];
    if (!d || FREE_MAIL.test(d)) continue;
    const key = l.health_detail?.siren || l.id;
    if (!by.has(d)) by.set(d, new Set());
    by.get(d).add(key);
  }
  return new Set([...by.entries()].filter(([, s]) => s.size > 1).map(([d]) => d));
}

const fmtDate = (d) => {
  if (!d) return "";
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString("fr-FR");
};
const fmtSiren = (s) => String(s || "").replace(/(\d{3})(?=\d)/g, "$1 ").trim();

// ── Brief ───────────────────────────────────────────────────────────────

/**
 * @param {object} lead  ligne du compte (health_detail, web_intel, call_prep, call_status,
 *                       standard_phone, bad_phones, sf_paste_flags, email…)
 * @param {{ contacts?: object[], shared?: Set<string>, now?: Date }} ctx
 */
export function buildCallBrief(lead, { contacts = [], shared = new Set(), now = new Date() } = {}) {
  const d = lead.health_detail || {};
  const anomalies = [];
  const add = (code, detail = "") => {
    if (!anomalies.some((a) => a.code === code)) anomalies.push({ code, ...ANOMALIES[code], detail });
  };

  const who = whoToCall({ account: lead, contacts });
  const email = lead.email !== undefined ? lead.email : pickEmail({ account: lead, contacts });

  // Faible potentiel : holding / siège social sans salarié.
  const holding = /^(64\.20Z|70\.10Z)$/.test(d.naf || "");
  if (holding && (!d.effectif || ["NN", "00", "01"].includes(String(d.effectif)))) {
    add("LOW_POTENTIAL", `NAF ${d.naf}, ${d.effectif === "01" ? "1 à 2 salariés" : "aucun salarié déclaré"}`);
  }

  // Établissement secondaire d'une association, d'une fédération ou d'un groupe.
  const etab = d.etab_match;
  if (etab && etab.est_siege === false && (d.est_association || (d.etablissements || 0) > 1 || d.groupe)) {
    add("HQ_DECIDES", `établissement de ${etab.commune || etab.code_postal || "?"}, siège à ${d.commune || "?"}`);
  }

  // Numéros : aucun, ou le seul connu est marqué « non attribué ».
  const phone = who.standard?.number || who.people.find((p) => p.phone)?.phone || "";
  if (!phone || lead.call_status === "faux_numero") {
    add("NO_VALID_PHONE", lead.call_status === "faux_numero" ? "dernier numéro marqué non attribué" : "ni standard ni ligne directe");
  } else {
    const dept = deptOf(d.siege_cp) || deptOf(etab?.code_postal);
    if (phoneMatchesDept(phone, dept) === false && phoneMatchesDept(phone, deptOf(etab?.code_postal)) !== true) {
      add("PHONE_AREA_MISMATCH", `${phone} pour le département ${dept}`);
    }
  }

  // Domaine partagé par plusieurs leads (réseau, fédération).
  const dom = (email?.email || "").split("@")[1];
  if (dom && shared.has(dom)) add("SHARED_DOMAIN", `${dom} utilisé par plusieurs sociétés`);

  // Contrôles de la fiche Salesforce collée.
  for (const f of lead.sf_paste_flags?.flags || []) if (ANOMALIES[f.code]) add(f.code, f.detail || "");

  // ── Verdict ──
  const strongSuccessor = d.successor?.confidence === "forte";
  let verdict; let reason;
  if (lead.health_status === "fermee" && !strongSuccessor) {
    verdict = "cloturer"; reason = `Société fermée${d.date_fermeture ? ` le ${fmtDate(d.date_fermeture)}` : ""} : clôturer le lead dans Salesforce.`;
  } else if (strongSuccessor) {
    verdict = "appeler"; reason = `Continue sous ${d.successor.name} (${d.successor.reason_label || "reprise"}) : appeler la société qui reprend.`;
  } else if (lead.health_status === "introuvable") {
    verdict = "verifier"; reason = "Société introuvable dans SIRENE : vérifier le nom ou le SIREN dans Salesforce.";
  } else if (anomalies.some((a) => a.code === "LOW_POTENTIAL")) {
    verdict = "faible"; reason = "Holding sans salarié : clôturer ou rattacher le lead à la société opérationnelle.";
  } else if (lead.health_status === "vigilance") {
    verdict = "verifier"; reason = `${lead.health_label || "Procédure en cours"} : appeler avec prudence.`;
  } else if (anomalies.some((a) => ["ADDR_MISMATCH", "EMAIL_DOMAIN_TYPO", "NO_VALID_PHONE", "PHONE_AREA_MISMATCH"].includes(a.code))) {
    const a = anomalies.find((x) => ["ADDR_MISMATCH", "EMAIL_DOMAIN_TYPO", "NO_VALID_PHONE", "PHONE_AREA_MISMATCH"].includes(x.code));
    verdict = "verifier"; reason = `${a.label}${a.detail ? ` (${a.detail})` : ""}.`;
  } else {
    verdict = "appeler";
    const p = who.people[0];
    reason = p ? `Demander ${p.name}${p.role ? `, ${p.role.toLowerCase()}` : ""}.` : "Demander le responsable informatique au standard.";
  }
  if (anomalies.some((a) => a.code === "HQ_DECIDES") && verdict === "appeler") {
    reason += " Les décisions se prennent probablement au siège.";
  }

  // ── Actualité : 3 faits datés au plus ──
  const w = lead.web_intel || {};
  const news = [
    d.procedure ? { date: d.procedure_date, text: d.procedure_nature || d.procedure, source: "BODACC" } : null,
    d.successor ? { date: d.successor.date || null, text: `${d.successor.reason_label || "Reprise"} : ${d.successor.name}`, source: "SIRENE / BODACC" } : null,
    ...(w.public_contracts || []).map((c) => ({ date: c.date || c.limite || null, text: `Appel d'offres : ${String(c.objet || "").slice(0, 90)}${c.limite ? ` (jusqu'au ${fmtDate(c.limite)})` : ""}`, source: "BOAMP" })),
    ...(w.news || []).map((n) => ({ date: n.date || null, text: n.titre, source: n.source || "Presse" })),
  ].filter((n) => n && n.text).sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 3);

  // ── Question d'ouverture ──
  const openingQuestion = anomalies.some((a) => a.code === "HQ_DECIDES")
    ? "Les choix informatiques de votre établissement se font-ils chez vous ou au siège ?"
    : holding || d.groupe
      ? "Les achats informatiques du groupe passent-ils par la holding ou par chaque société ?"
      : isPublicBuyer(d)
        ? "Vos prochains achats de serveurs ou de stockage passeront-ils par un marché, ou par une centrale d'achat ?"
        : lead.question || "Y a-t-il un sujet en cours (extension, renouvellement, incident) sur lequel je peux vous aider ?";

  // ── Note Salesforce (5 lignes, données publiques uniquement) ──
  const paste = lead.sf_paste_flags || {};
  const p0 = who.people[0];
  const sfNote = [
    `${fmtDate(now)} — vérification Fox Prospect`,
    `${d.sirene_name || lead.name}${d.siren ? ` — SIREN ${fmtSiren(d.siren)}` : ""} — siège : ${[d.siege_cp, d.commune].filter(Boolean).join(" ") || "?"}${paste.code_postal ? ` (fiche Salesforce : ${[paste.code_postal, paste.commune].filter(Boolean).join(" ")})` : ""}`,
    `Constat : ${VERDICTS[verdict].label}. ${reason}${anomalies.length ? ` Anomalies : ${anomalies.map((a) => a.label + (a.detail ? ` (${a.detail})` : "")).join(" ; ")}.` : ""}`,
    `Contacts : ${[p0 ? `${p0.name}${p0.role ? ` (${p0.role})` : ""}` : null, who.standard ? `standard ${who.standard.number}` : null, email?.email ? `email ${email.email}` : null].filter(Boolean).join(" · ") || "aucun contact public"}`,
    `Motif : ${verdict === "cloturer" ? "société fermée" : verdict === "faible" ? "holding sans activité opérationnelle" : verdict === "verifier" ? "données à corriger avant relance" : "prospection en cours"}`,
  ].join("\n");

  return {
    verdict, verdict_label: VERDICTS[verdict].label, verdict_color: VERDICTS[verdict].color, reason,
    anomalies, news, who, openingQuestion, sfNote,
    sf_fix: anomalies.some((a) => a.sf),
  };
}
