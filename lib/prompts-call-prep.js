// ============================================================
// PROMPTS — Fiche d'approche d'un compte (inside sales Dell).
// Objectif : tout ce qu'il faut pour joindre le responsable informatique —
// qui il est, comment le joindre (standard, email, LinkedIn), quoi lui dire —
// et des messages prêts à envoyer sur les canaux écrits. L'appel, le
// commercial le fait lui-même.
// ============================================================

export function callPrepSystemPrompt() {
  return `Tu es un assistant de prospection B2B IT (marché français) pour un commercial inside sales de Dell Technologies (serveurs PowerEdge, stockage PowerStore/PowerScale/PowerVault, sauvegarde PowerProtect/Data Domain, hyperconvergé VxRail, PC et postes de travail).

Le commercial n'a qu'un nom de société. Il veut obtenir un échange avec le RESPONSABLE INFORMATIQUE (ou la personne en charge de l'IT) pour qualifier son infrastructure (serveurs, hyperviseur, stockage, sauvegarde, dates de fin de maintenance) et un éventuel projet.

Avec la recherche web (site officiel, mentions légales, page contact, LinkedIn public, presse, offres d'emploi, annuaires publics, BOAMP/TED pour le public), trouve :

1. COORDONNÉES de la société : site web, téléphone du standard, email générique de contact, domaine des emails, adresse du siège. Uniquement ce qui est publié (site, mentions légales, annuaire public). Si l'adresse email d'un salarié est publiée quelque part, déduis-en le format des emails (ex. prenom.nom@domaine.fr) et dis d'où tu le tiens.
2. INTERLOCUTEURS : les personnes en charge de l'informatique identifiées PUBLIQUEMENT (DSI, responsable informatique / infrastructure / systèmes et réseaux, RSSI ; dans une petite structure : dirigeant, DAF ou responsable administratif qui gère l'IT ; dans le public : DSI, responsable du service informatique). Pour chacun : prénom, nom, poste, URL LinkedIn si trouvée, source. Signale si l'IT semble externalisée (prestataire infogérant nommé publiquement).
3. ACTUALITÉ exploitable (12-18 mois) : croissance, rachat, nouveau site, déménagement, recrutement IT, appel d'offres, projet SI, cyberattaque, nouvelle direction. Datée et sourcée.
4. ANGLE d'approche : pourquoi Dell, pourquoi maintenant, en une ou deux phrases.
5. MESSAGES prêts à envoyer, en français, personnalisés avec l'actualité ou le contexte (jamais génériques), vouvoiement, courts, sans jargon marketing, avec un appel à l'action simple (un échange de 15 minutes) :
   - email de premier contact (objet + corps ≤ 120 mots, signature « [Prénom Nom] — Dell Technologies »), avec une ligne de désinscription discrète en fin (« Si ce sujet n'est pas pour vous, dites-le-moi et je ne vous relancerai pas. ») ;
   - invitation LinkedIn (≤ 280 caractères) ;
   - message LinkedIn après acceptation (≤ 500 caractères) ;
   - email de relance J+7 (objet + corps ≤ 80 mots), qui apporte un élément nouveau.
6. PASSAGE DU STANDARD : 2-3 phrases honnêtes pour obtenir le nom et la ligne du bon interlocuteur, et quoi répondre à « envoyez un mail ».

Règles strictes :
- Informations PUBLIQUES et professionnelles uniquement. Pas de vie privée, pas de numéro de portable personnel.
- N'invente JAMAIS un nom, un email, un numéro ou une URL. Ce qui n'est pas trouvé reste vide ("" ou null) — l'honnêteté prime ; le commercial complétera avec ZoomInfo.
- Un email personnel déduit d'un format n'est PAS un fait : ne le mets que dans "format_email", pas dans un contact.

Tu réponds UNIQUEMENT avec un JSON valide, sans préambule ni markdown, au format exact :
{
  "identite": "activité, taille, sites en 2 phrases",
  "coordonnees": { "site": "url ou null", "standard": "téléphone ou null", "email_generique": "email ou null", "domaine_email": "domaine ou null", "format_email": "ex. prenom.nom@domaine.fr ou null", "format_source": "où ce format a été observé ou null", "adresse": "adresse du siège ou null" },
  "contacts": [ { "prenom": "", "nom": "", "poste": "", "linkedin_url": "url ou null", "source": "url", "confiance": "haute|moyenne|basse", "pourquoi": "son rôle dans une décision infra" } ],
  "it_externalisee": "nom du prestataire et source, ou null",
  "postes_a_chercher": ["intitulés à chercher dans ZoomInfo si aucun contact trouvé"],
  "actus": [ { "titre": "fait daté", "date": "YYYY-MM", "source": "url" } ],
  "angle": "1-2 phrases",
  "messages": {
    "email": { "objet": "", "corps": "" },
    "linkedin_invitation": "",
    "linkedin_message": "",
    "relance": { "objet": "", "corps": "" }
  },
  "standard": { "phrases": ["…"], "si_mail": "…" },
  "sources": ["url"]
}
Maximum : 4 contacts, 3 actus, 3 phrases de standard.`;
}

export function callPrepUserPrompt({ account, health, sender }) {
  const h = health || {};
  const lines = [
    `Société : ${account.name}`,
    h.sirene_name && h.sirene_name !== account.name ? `Raison sociale officielle : ${h.sirene_name}` : "",
    h.successor?.confidence === "forte"
      ? `⚠️ Le nom Salesforce est l'ancienne identité : la société continue sous « ${h.successor.name} » (${h.successor.reason_label}). Fais la recherche sous ce nom.`
      : "",
    h.siren ? `SIREN : ${h.siren}` : "",
    h.commune ? `Siège : ${h.commune}` : "",
    h.naf ? `Code NAF : ${h.naf}` : "",
    h.effectif ? `Tranche d'effectif INSEE : ${h.effectif}` : "",
    h.categorie ? `Catégorie : ${h.categorie}` : "",
    (h.dirigeants || []).length
      ? `Dirigeants légaux (RNE) : ${h.dirigeants.map((d) => `${d.name}${d.role ? ` (${d.role})` : ""}`).join(", ")}`
      : "",
    account.website ? `Site web connu : ${account.website}` : "",
    h.procedure ? `⚠️ Procédure collective : ${h.procedure_nature || h.procedure} (${h.procedure_date || "date inconnue"})` : "",
  ].filter(Boolean);

  const signature = sender?.sender_name
    ? `Signe les emails « ${sender.sender_name} — Dell Technologies ».`
    : "Laisse « [Prénom Nom] — Dell Technologies » en signature.";

  return `${lines.join("\n")}

${signature}

Cherche les coordonnées, les interlocuteurs IT et l'actualité, puis réponds avec le JSON demandé.`;
}

const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const str = (v) => (typeof v === "string" ? v.trim() : "");
const strOrNull = (v) => (typeof v === "string" && v.trim() && !/^null$/i.test(v.trim()) ? v.trim() : null);
const url = (v) => {
  const s = strOrNull(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

/** Borne et type la réponse du modèle avant mise en cache. */
export function normalizeCallPrep(json) {
  const c = json?.coordonnees || {};
  const m = json?.messages || {};
  const std = json?.standard || {};
  return {
    identite: str(json?.identite),
    coordonnees: {
      site: url(c.site),
      standard: strOrNull(c.standard),
      email_generique: strOrNull(c.email_generique),
      domaine_email: strOrNull(c.domaine_email),
      format_email: strOrNull(c.format_email),
      format_source: strOrNull(c.format_source),
      adresse: strOrNull(c.adresse),
    },
    contacts: arr(json?.contacts, 4)
      .map((p) => ({
        prenom: str(p?.prenom),
        nom: str(p?.nom),
        poste: str(p?.poste),
        linkedin_url: url(p?.linkedin_url),
        source: strOrNull(p?.source),
        confiance: ["haute", "moyenne", "basse"].includes(p?.confiance) ? p.confiance : "basse",
        pourquoi: str(p?.pourquoi),
      }))
      .filter((p) => p.nom || p.prenom),
    it_externalisee: strOrNull(json?.it_externalisee),
    postes_a_chercher: arr(json?.postes_a_chercher, 4).map(String),
    actus: arr(json?.actus, 3)
      .map((a) => ({ titre: str(a?.titre), date: str(a?.date), source: strOrNull(a?.source) }))
      .filter((a) => a.titre),
    angle: str(json?.angle),
    messages: {
      email: { objet: str(m.email?.objet), corps: str(m.email?.corps) },
      linkedin_invitation: str(m.linkedin_invitation).slice(0, 300),
      linkedin_message: str(m.linkedin_message),
      relance: { objet: str(m.relance?.objet), corps: str(m.relance?.corps) },
    },
    standard: { phrases: arr(std.phrases, 3).map(String), si_mail: str(std.si_mail) },
    sources: arr(json?.sources, 8).map(String),
  };
}

/** Message lisible pour une erreur de l'API Anthropic. */
export function explainAiError(message = "") {
  const m = String(message);
  if (/credit balance|billing|insufficient/i.test(m)) {
    return "Crédit Anthropic épuisé : recharge ton compte sur console.anthropic.com (Billing), puis réessaie.";
  }
  if (/Anthropic API 401|invalid x-api-key|authentication_error/i.test(m)) {
    return "Clé API Anthropic invalide ou révoquée : crée une nouvelle clé sur console.anthropic.com et remplace ANTHROPIC_API_KEY sur Vercel.";
  }
  if (/Anthropic API 404|not_found_error/i.test(m)) {
    return "Modèle IA introuvable (retiré ou renommé) : le nom du modèle est à mettre à jour dans lib/constants.js.";
  }
  if (/Anthropic API 429/i.test(m)) return "L'API Anthropic limite le débit : réessaie dans une minute.";
  if (/Anthropic API 529|overloaded/i.test(m)) return "L'API Anthropic est surchargée : réessaie dans quelques minutes.";
  return m;
}

/**
 * Contacts de la fiche → lignes account_contacts à créer (sans doublon de nom
 * avec l'organigramme existant). Rien n'est validé : le commercial confirme.
 */
export function contactsToInsert(prep, existing = [], accountId) {
  const key = (f, l) => `${f} ${l}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const known = new Set(existing.map((c) => key(c.first_name || "", c.last_name || "")));
  const month = new Date().toISOString().slice(0, 7);
  return (prep?.contacts || [])
    .filter((p) => !known.has(key(p.prenom, p.nom)))
    .map((p) => ({
      account_id: accountId,
      first_name: p.prenom,
      last_name: p.nom,
      role: p.poste,
      responsibilities: p.pourquoi,
      linkedin_url: p.linkedin_url || "",
      source: p.source || "Fiche d'approche (recherche web)",
      reliability: p.linkedin_url ? "partiel" : "non_verifie",
      role_confidence: p.confiance === "haute" ? "certain" : p.confiance === "moyenne" ? "probable" : "incertain",
      data_date: month,
    }));
}
