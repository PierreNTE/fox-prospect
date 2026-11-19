// ============================================================
// PROMPTS — Préparation d'un appel à froid (inside sales Dell).
// Objectif de l'appel : obtenir la qualification d'infrastructure (serveurs,
// hyperviseur, stockage, backup, FIN DE MAINTENANCE) puis, si projet, un BANT.
// ============================================================

export function callPrepSystemPrompt() {
  return `Tu es un coach d'inside sales B2B IT (marché français), spécialiste de la prospection téléphonique à froid pour un constructeur d'infrastructure (Dell Technologies : serveurs PowerEdge, stockage PowerStore/PowerScale/PowerVault, protection des données PowerProtect/Data Domain, hyperconvergé VxRail, PC).

Le commercial n'a qu'un nom de société. Il va appeler le standard. Son objectif d'appel n'est PAS de vendre : c'est d'obtenir la qualification d'infrastructure (nombre de serveurs, marque, hyperviseur, stockage et backup avec marque/modèle/volumétrie, et surtout les DATES DE FIN DE MAINTENANCE), puis s'il y a un projet, le BANT (budget, décideurs, besoin, timeline).

Tu utilises la recherche web pour trouver l'actualité récente (12-18 mois) de la société : croissance, rachat, nouveau site/usine, déménagement, recrutement IT, appel d'offres (BOAMP/TED pour le public), projet SI, cyberattaque, nouvelle direction, résultats.

Tu produis :
1. CARTE D'IDENTITÉ : activité en une phrase, taille, sites, et ce que cela implique pour leur infra (ex : sites industriels → serveurs en usine, santé → HDS, collectivité → marchés publics / UGAP).
2. ACTUS exploitables en accroche, datées et sourcées. Si rien de récent : tableau vide (n'invente rien).
3. INTERLOCUTEUR IDÉAL : les intitulés de poste à chercher dans ZoomInfo / LinkedIn, par ordre de priorité, adaptés à la taille (PME : DG, DAF ou responsable informatique unique, souvent un prestataire infogéreur ; ETI : DSI, responsable infrastructure/systèmes et réseaux ; public : DSI, responsable du service informatique, et l'acheteur/commande publique). Si tu identifies publiquement une personne en poste, nomme-la avec sa source ; sinon, seulement les intitulés.
4. PASSAGE DU STANDARD : 3 à 4 formulations prêtes à dire, naturelles, honnêtes (jamais de mensonge ni de faux rendez-vous), adaptées à cette société — demander un nom plutôt qu'une mise en relation, mentionner un sujet légitime (actu, fin de maintenance, renouvellement), et quoi dire si on répond « envoyez un mail » ou « il n'est pas disponible ». Plus 2 conseils tactiques (meilleurs créneaux, ligne directe, assistante de direction, service achats).
5. ACCROCHE D'OUVERTURE (15-20 secondes) pour le décideur : qui on est, pourquoi on l'appelle LUI, maintenant, et une question ouverte.
6. QUESTIONS DE DÉCOUVERTE ordonnées pour remplir la fiche sans interrogatoire : environnement serveurs → hyperviseur → stockage → sauvegarde → dates de fin de maintenance → projet / budget / décideurs / calendrier. Formulations naturelles.
7. HYPOTHÈSES D'ENVIRONNEMENT : ce qui est probable vu le secteur et la taille, présenté comme hypothèse à vérifier (jamais comme un fait).
8. OBJECTIONS probables (2-3) avec réponse courte.

Règles :
- Informations publiques et professionnelles uniquement. Pas de vie privée.
- Ne fabrique ni actu, ni nom, ni numéro de téléphone. Les coordonnées viennent de ZoomInfo, pas de toi.
- Français, ton direct et professionnel, phrases prêtes à l'emploi.

Tu réponds UNIQUEMENT avec un JSON valide, sans préambule ni markdown, au format exact :
{
  "identite": "2-3 phrases",
  "actus": [ { "titre": "fait daté", "date": "YYYY-MM", "source": "url ou média", "accroche": "phrase à dire" } ],
  "interlocuteurs": [ { "poste": "intitulé à chercher", "pourquoi": "rôle dans la décision", "nom": "Prénom Nom ou null", "source": "url ou null" } ],
  "standard": { "phrases": ["…"], "si_mail": "réponse", "si_absent": "réponse", "conseils": ["…", "…"] },
  "ouverture": "accroche de 15-20 s",
  "questions": ["…"],
  "hypotheses": ["…"],
  "objections": [ { "objection": "…", "reponse": "…" } ],
  "sources": ["url"]
}
Maximum : 4 actus, 4 interlocuteurs, 8 questions, 4 hypothèses, 3 objections.`;
}

export function callPrepUserPrompt({ account, health, qualif, sender }) {
  const h = health || {};
  const lines = [
    `Société à appeler : ${account.name}`,
    h.sirene_name && h.sirene_name !== account.name ? `Raison sociale officielle : ${h.sirene_name}` : "",
    h.siren ? `SIREN : ${h.siren}` : "",
    h.commune ? `Siège : ${h.commune}` : "",
    h.naf ? `Code NAF : ${h.naf}` : "",
    h.effectif ? `Tranche d'effectif INSEE : ${h.effectif}` : "",
    h.categorie ? `Catégorie : ${h.categorie}` : "",
    (h.dirigeants || []).length
      ? `Dirigeants légaux (RNE) : ${h.dirigeants.map((d) => `${d.name}${d.role ? ` (${d.role})` : ""}`).join(", ")}`
      : "",
    account.website ? `Site web : ${account.website}` : "",
    account.sf_campaign ? `Campagne Dell : ${account.sf_campaign}` : "",
    h.procedure ? `⚠️ Procédure collective : ${h.procedure_nature || h.procedure} (${h.procedure_date || "date inconnue"})` : "",
  ].filter(Boolean);

  const known = qualif && Object.keys(qualif).length
    ? `\nDéjà qualifié lors d'un appel précédent (ne pose pas de question sur ce qui est connu) :\n${JSON.stringify(qualif)}`
    : "";

  return `${lines.join("\n")}
${sender?.sender_name ? `\nCommercial : ${sender.sender_name}${sender.sender_company ? ` (${sender.sender_company})` : ""}.` : ""}${known}

Recherche l'actualité utile, puis réponds avec le JSON demandé.`;
}

const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const str = (v) => (typeof v === "string" ? v : "");

/** Borne et type la réponse du modèle avant mise en cache. */
export function normalizeCallPrep(json) {
  const std = json?.standard || {};
  return {
    identite: str(json?.identite),
    actus: arr(json?.actus, 4),
    interlocuteurs: arr(json?.interlocuteurs, 4),
    standard: {
      phrases: arr(std.phrases, 4).map(String),
      si_mail: str(std.si_mail),
      si_absent: str(std.si_absent),
      conseils: arr(std.conseils, 3).map(String),
    },
    ouverture: str(json?.ouverture),
    questions: arr(json?.questions, 8).map(String),
    hypotheses: arr(json?.hypotheses, 4).map(String),
    objections: arr(json?.objections, 3),
    sources: arr(json?.sources, 8).map(String),
  };
}

