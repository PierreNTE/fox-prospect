// Passage de relais vers l'agent Sales Chat (IA interne de Dell) : chaque
// semaine, un fichier avec un email par lead et le message prêt, plus les
// instructions à donner une fois pour toutes à l'agent. L'envoi se fait dans
// l'environnement Dell (messagerie pro), jamais depuis cette appli.
import { CALL_STATUS_META, isFinalStatus } from "@/lib/call-status";

export const EXPORT_COLUMNS = [
  ["societe", "Société"], ["ville", "Ville"], ["destinataire", "Destinataire"], ["poste", "Poste"],
  ["email", "Email"], ["confiance_email", "Confiance email"], ["source_email", "Source email"],
  ["email_generique", "Email générique"], ["telephone", "Téléphone"],
  ["objet", "Objet"], ["message", "Message"], ["relance_objet", "Objet relance J+7"], ["relance_message", "Message relance J+7"],
  ["accroche", "Accroche"], ["question", "Question"], ["statut_appel", "Statut d'appel"], ["priorite", "Priorité"],
  ["fiche", "Fiche"],
];

const EXCLUDED_STATUS = new Set(["rdv", "pas_interesse", "mauvais_contact"]);
const isOpen = (l) => ["active", "vigilance"].includes(l.health_status) && !/closed/i.test(l.sf_lead_status || "");

/**
 * Lignes de l'export (pur, testé). Un lead entre s'il est actif, a un email,
 * n'est ni RDV, ni pas intéressé, ni mauvais contact, et n'a pas été exporté
 * depuis `sinceDays` jours (sauf `all`).
 */
export function buildExportRows(leads, { baseUrl = "", all = false, sinceDays = 25, now = Date.now() } = {}) {
  const cutoff = now - sinceDays * 86400000;
  return leads
    .filter((l) => isOpen(l) && !EXCLUDED_STATUS.has(l.call_status)
      && (all || !l.email_exported_at || new Date(l.email_exported_at).getTime() < cutoff))
    .map((l) => {
      // Sans email : la ligne part quand même, l'agent cherche l'adresse dans
      // les outils Dell auxquels il a accès (Salesforce, ZoomInfo…).
      const e = l.email || { email: "", confidence: "à trouver", source: "", generic: false };
      const named = e.email ? (!e.generic && (e.name || l.contact?.name)) : l.contact?.name;
      return {
        id: l.id,
        societe: l.sirene_name || l.name,
        ville: l.commune || "",
        destinataire: named ? (e.name || l.contact?.name || "") : "",
        poste: named ? (e.role || l.contact?.role || "") : "",
        email: e.email,
        confiance_email: e.confidence,
        source_email: e.source || "",
        email_generique: e.generic ? "oui" : "non",
        telephone: l.standard?.number || l.contact?.phone || "",
        objet: l.email_subject || "",
        message: l.email_body || "",
        relance_objet: l.followup_subject || "",
        relance_message: l.followup_body || "",
        accroche: l.hook || "",
        question: l.question || "",
        statut_appel: CALL_STATUS_META[l.call_status]?.label || "À appeler",
        priorite: l.priority?.tier && l.priority.tier !== "X" ? l.priority.tier : "",
        fiche: baseUrl ? `${baseUrl}/accounts/${l.id}` : "",
      };
    });
}

/** CSV pour Excel en français : séparateur « ; », BOM UTF-8, champs entre guillemets. */
export function toCsv(rows, columns = EXPORT_COLUMNS) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [columns.map(([, label]) => esc(label)).join(";")];
  for (const r of rows) lines.push(columns.map(([k]) => esc(r[k])).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Instructions à coller une seule fois dans l'agent Sales Chat. */
export function buildAgentInstructions({ senderName = "", senderRole = "" } = {}) {
  const me = senderName || "[ton prénom et nom]";
  const role = senderRole || "Account Executive";
  return `Tu es l'assistant de prospection de ${me}, ${role} chez Dell Technologies.

CONTEXTE
Chaque semaine, je te donne un fichier CSV exporté de mon outil de prospection : une ligne par société à contacter, avec l'email à utiliser, son niveau de confiance et un message déjà personnalisé (accroche sur un fait réel de la société).

COLONNES
Société, Ville, Destinataire, Poste, Email, Confiance email (sûr / probable / supposé / à trouver), Source email, Email générique (oui/non), Téléphone, Objet, Message, Objet relance J+7, Message relance J+7, Accroche, Question, Statut d'appel, Priorité, Fiche.

POUR CHAQUE LIGNE
0. Si Email est vide (confiance « à trouver ») : cherche, dans les outils Dell auxquels tu as accès (Salesforce, ZoomInfo…), le responsable informatique de la société (ou à défaut le dirigeant, colonne Destinataire) et son email professionnel. Si tu en trouves un, utilise-le avec la confiance « probable » et indique la source. Sinon, mets la ligne en « ignoré — email introuvable » : je l'appellerai (colonne Téléphone).
1. Vérifie qu'elle est envoyable :
   - l'email est présent et bien formé ;
   - la société n'est pas un client existant, ni un compte suivi par un autre commercial, ni en opposition (« Email Opt Out » dans Salesforce, liste de désinscription) ; si tu n'as pas accès à ces informations, dis-le dans le récapitulatif au lieu de deviner.
2. Rédige l'email à partir des colonnes Objet, Message et Accroche :
   - en français, vouvoiement, 120 mots maximum, ton direct et courtois ;
   - si Email générique = oui : commence par « Bonjour, » et demande de transmettre à la personne en charge de l'informatique ;
   - sinon : « Bonjour [Destinataire], » (sans destinataire : « Bonjour, ») ;
   - garde l'accroche telle quelle (c'est un fait vérifié) et termine par une seule question ou la proposition d'un échange de 15 minutes ;
   - aucune pièce jointe, aucun prix, aucune remise, aucune information interne Dell ;
   - signature : ${me} · ${role} · Dell Technologies ;
   - dernière ligne : « Si vous ne souhaitez plus recevoir de message de ma part, répondez simplement STOP. »
3. Envoie ou prépare selon le MODE.

MODE = VALIDATION
(remplace VALIDATION par AUTOMATIQUE quand les premiers envois te conviennent)
- VALIDATION : prépare tous les emails en brouillon, puis montre-moi le récapitulatif. N'envoie rien tant que je n'ai pas répondu « envoie ».
- AUTOMATIQUE : envoie directement les emails dont la confiance est « sûr » ou « probable ». Les « supposé » (adresse construite, risque de rebond) restent en brouillon jusqu'à ma validation.

LIMITES
- 40 envois par jour maximum, étalés entre 9 h et 17 h, du lundi au vendredi.
- Un seul email par société et par semaine, jamais deux fois la même adresse en 30 jours.
- Relance : 7 jours après l'envoi, sans réponse, envoie une seule fois le message de relance (colonnes relance), dans le même fil. Pas de deuxième relance.

RÉCAPITULATIF (après chaque passage)
Un tableau : Société · Email · Confiance · Statut (envoyé / brouillon / ignoré / rebond) · Raison.
Les emails revenus en erreur (adresse inexistante) : liste-les à part, je corrigerai l'adresse dans mon outil.
Les emails que tu as trouvés toi-même (étape 0) : liste-les à part (Société · Email · Source), je les enregistrerai dans mon outil.

RÉPONSES
Chaque vendredi, classe les réponses reçues : intéressé · pas maintenant (avec la date de rappel proposée) · pas intéressé · désinscription (STOP). Une société qui a répondu STOP n'est plus jamais contactée.`;
}
