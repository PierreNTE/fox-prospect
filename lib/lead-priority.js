// Priorité d'appel d'un lead Salesforce — déterministe, gratuite, explicable.
//
// Objectif : décider dans quel ordre appeler (et pour quels comptes payer une
// fiche d'approche IA à ~0,10 €) à partir des seules données publiques déjà
// récupérées à l'import (SIRENE + BODACC, dans accounts.health_detail).
// Aucune donnée Salesforce autre que le statut du lead n'est utilisée.
//
// Le module cold calling Dell qualifie l'infra (serveurs, stockage, backup) :
// la taille pèse donc plus que pour une vente de postes de travail. Tous les
// poids sont dans LEAD_PRIORITY_CONFIG pour être ajustés au retour terrain.

export const LEAD_PRIORITY_CONFIG = {
  // Tranche d'effectif INSEE → points (max 40).
  size: [
    { codes: ["NN", "00", "0", ""], pts: 6, label: "effectif non déclaré" },
    { codes: ["01", "1", "02", "2", "03", "3"], pts: 4, label: "moins de 10 salariés" },
    { codes: ["11"], pts: 16, label: "10-19 salariés" },
    { codes: ["12"], pts: 26, label: "20-49 salariés" },
    { codes: ["21", "22"], pts: 40, label: "50-199 salariés" },
    { codes: ["31", "32"], pts: 36, label: "200-499 salariés" },
    { codes: ["41", "42", "51", "52", "53", "54", "55", "56"], pts: 28, label: "500 salariés et plus" },
  ],
  // Préfixe NAF (2 chiffres) → points (max 25). Besoin infra / données.
  sector: [
    { prefixes: ["62", "63", "58", "61"], pts: 25, label: "numérique / télécoms" },
    { prefixes: ["64", "65", "66"], pts: 22, label: "finance / assurance" },
    { prefixes: ["86", "87"], pts: 22, label: "santé / médico-social" },
    { prefixes: ["71", "72", "73", "74"], pts: 20, label: "ingénierie / études / design" },
    { prefixes: ["69", "70"], pts: 18, label: "conseil / juridique / comptable" },
    { prefixes: ["49", "50", "51", "52", "53"], pts: 18, label: "transport / logistique" },
    { prefixes: ["10", "11", "20", "21", "22", "24", "25", "26", "27", "28", "29", "30", "32"], pts: 18, label: "industrie" },
    { prefixes: ["45", "46", "47"], pts: 12, label: "commerce" },
    { prefixes: ["41", "42", "43"], pts: 12, label: "BTP" },
    { prefixes: ["85"], pts: 12, label: "enseignement" },
    { prefixes: ["55", "56"], pts: 8, label: "hôtellerie / restauration" },
  ],
  sectorDefault: { pts: 10, label: "autre secteur" },
  // Catégorie INSEE.
  category: { ETI: 10, GE: 8, PME: 4 },
  // Établissements ouverts (si connu).
  sites: [{ min: 10, pts: 10 }, { min: 3, pts: 7 }, { min: 2, pts: 4 }],
  // Chiffre d'affaires le plus récent publié (si connu).
  revenue: [{ min: 50e6, pts: 10 }, { min: 10e6, pts: 8 }, { min: 2e6, pts: 5 }, { min: 0, pts: 1 }],
  // Statut du lead : un lead « Working » est déjà engagé → bonus de suivi.
  working: 5,
  penalties: {
    holding: -20,      // 64.20Z : l'achat IT se fait dans les filiales
    publicBuyer: -10,  // 84.xx ou nature juridique 7xxx : marché / centrale d'achat
    association: -8,   // 94.xx ou nature juridique 92xx
    probableMatch: -5, // rapprochement SIRENE seulement « probable »
    vigilance: -15,    // procédure collective en cours (redressement, sauvegarde…)
  },
  tiers: { A: 60, B: 40 },
};

const nafPrefix = (naf) => String(naf || "").replace(/[^0-9]/g, "").slice(0, 2);
const nafCompact = (naf) => String(naf || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/** Angle d'appel suggéré, orienté infra (serveurs, stockage, sauvegarde). */
export function leadAngle({ naf, publicBuyer } = {}) {
  const p = nafPrefix(naf);
  if (publicBuyer) return "Acheteur public : identifier le marché ou la centrale d'achat en place avant de pitcher";
  if (["62", "63", "58", "61"].includes(p)) return "Numérique : capacité serveurs, environnements de dev/test, stockage qui suit la croissance";
  if (["64", "65", "66"].includes(p)) return "Finance : sauvegarde immuable et reprise après cyberattaque (DORA)";
  if (["86", "87"].includes(p)) return "Santé : disponibilité des données patients et sauvegarde (HDS, NIS2)";
  if (["71", "72", "73", "74"].includes(p)) return "Ingénierie / design : stockage des fichiers lourds (CAO, BIM) et postes de calcul";
  if (["49", "50", "51", "52", "53"].includes(p)) return "Logistique : continuité de service des systèmes d'exploitation (WMS, TMS)";
  if (["10", "11", "20", "21", "22", "24", "25", "26", "27", "28", "29", "30", "32"].includes(p))
    return "Industrie : serveurs sur site pour la production, sauvegarde et continuité";
  return "Renouvellement du parc serveurs / stockage et sauvegarde des données";
}

/**
 * @param {{ sf_lead_status?: string, health_status?: string, health_detail?: object }} lead
 * @returns {{ score: number, tier: "A"|"B"|"C"|"X", reasons: string[], flags: string[], angle: string }}
 */
export function computeLeadPriority(lead = {}) {
  const C = LEAD_PRIORITY_CONFIG;
  const d = lead.health_detail || {};
  const reasons = [];
  const flags = [];

  if (/closed|rejected/i.test(lead.sf_lead_status || "")) {
    return { score: 0, tier: "X", reasons: ["Lead clos dans Salesforce"], flags, angle: "" };
  }
  if (lead.health_status === "fermee") {
    return { score: 0, tier: "X", reasons: ["Société fermée ou liquidée : à clôturer"], flags, angle: "" };
  }
  if (!d.siren) {
    return {
      score: 15, tier: "C",
      reasons: ["SIREN non résolu : priorité impossible à calculer"],
      flags: ["Vérifie le nom ou le SIREN"], angle: leadAngle({}),
    };
  }

  let s = 0;
  const code = String(d.effectif ?? "").trim();
  const size = C.size.find((x) => x.codes.includes(code)) || C.size[0];
  s += size.pts; reasons.push(`${size.label} (+${size.pts})`);

  const p = nafPrefix(d.naf);
  const sector = C.sector.find((x) => x.prefixes.includes(p)) || C.sectorDefault;
  s += sector.pts; reasons.push(`${sector.label}${d.naf ? ` · NAF ${d.naf}` : ""} (+${sector.pts})`);

  const cat = C.category[d.categorie];
  if (cat) { s += cat; reasons.push(`${d.categorie} (+${cat})`); }

  if (Number.isFinite(d.etablissements)) {
    const site = C.sites.find((x) => d.etablissements >= x.min);
    if (site) { s += site.pts; reasons.push(`${d.etablissements} établissements ouverts (+${site.pts})`); }
  }

  if (d.ca != null && Number.isFinite(Number(d.ca))) {
    const ca = Number(d.ca);
    const rev = C.revenue.find((x) => ca >= x.min);
    s += rev.pts; reasons.push(`CA ${d.ca_annee || ""} ${(ca / 1e6).toFixed(1)} M€ (+${rev.pts})`.replace("  ", " "));
  }

  if (/working/i.test(lead.sf_lead_status || "")) { s += C.working; reasons.push(`Lead déjà en cours (+${C.working})`); }

  const P = C.penalties;
  const nj = String(d.nature_juridique || "");
  const publicBuyer = p === "84" || nj.startsWith("7");
  if (nafCompact(d.naf) === "6420Z") { s += P.holding; flags.push("Holding : identifier la filiale opérationnelle qui achète"); }
  if (publicBuyer) { s += P.publicBuyer; flags.push("Acheteur public : marché ou centrale d'achat"); }
  if (p === "94" || nj.startsWith("92")) { s += P.association; flags.push("Association : budget IT souvent limité"); }
  if (d.match_confidence === "probable") { s += P.probableMatch; flags.push("Rapprochement SIRENE probable : vérifie le SIREN"); }
  if (lead.health_status === "vigilance") { s += P.vigilance; flags.push("Procédure collective en cours"); }

  const score = Math.max(0, Math.min(100, Math.round(s)));
  const tier = score >= C.tiers.A ? "A" : score >= C.tiers.B ? "B" : "C";
  return { score, tier, reasons, flags, angle: leadAngle({ naf: d.naf, publicBuyer }) };
}

/** Tri : A > B > C > X, puis score décroissant, puis nom. */
export function sortByPriority(leads) {
  const rank = { A: 0, B: 1, C: 2, X: 3 };
  return [...leads].sort((a, b) =>
    (rank[a.priority?.tier] ?? 4) - (rank[b.priority?.tier] ?? 4)
    || (b.priority?.score ?? 0) - (a.priority?.score ?? 0)
    || String(a.name || "").localeCompare(String(b.name || ""), "fr"));
}

/** Nouveau = apparu pour la première fois dans un import il y a moins de `days` jours. */
export function isNewLead(lead, now = Date.now(), days = 7) {
  const t = Date.parse(lead.sf_first_seen_at || "");
  return Number.isFinite(t) && now - t < days * 86400_000;
}

/**
 * Absent du dernier import : vu lors d'un import précédent mais pas dans le plus
 * récent (lead réattribué ou clos dans Salesforce). Fenêtre de 12 h autour du
 * dernier import, qui se fait en plusieurs lots de quelques minutes.
 */
export function isMissingFromLastImport(lead, lastImportAt) {
  const seen = Date.parse(lead.sf_last_seen_at || "");
  const last = Date.parse(lastImportAt || "");
  return Number.isFinite(seen) && Number.isFinite(last) && last - seen > 12 * 3600_000;
}
