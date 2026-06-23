// Next Best Action — déterministe, sans LLM.
// Depuis P2, le statut n'encode QUE la situation commerciale. L'état de recherche
// se lit via la présence d'une recherche (`research`) et de brouillons (`drafts`),
// et l'opposition RGPD via le drapeau `prospect.do_not_contact`.

const URGENT_TYPES = new Set(["rfp_it", "incident", "recrutement"]);

/**
 * @param {{ prospect: object, research?: object|null, drafts?: object|null }} opts
 * @returns {{ action: string, label: string, priority: number, reason: string, cta_label: string|null, cta_action: string|null }}
 */
export function computeNba({ prospect, research = null, drafts = null } = {}) {
  const status = prospect.status || "non_contacte";
  const hasPhone = !!(prospect.phone && String(prospect.phone).trim());
  const hasEmail = !!(prospect.email && String(prospect.email).trim());

  // ── Opposition RGPD (drapeau séparé du statut) ──────────────────────────────
  if (prospect.do_not_contact) {
    return {
      action: "opt_out", label: "Ne pas contacter", priority: 0,
      reason: "Contact en opposition permanente — ne jamais recontacter.",
      cta_label: null, cta_action: null,
    };
  }

  // ── Statuts terminaux ───────────────────────────────────────────────────────
  if (status === "refuse") {
    return {
      action: "archive", label: "Refusé", priority: 0,
      reason: "Opportunité fermée.",
      cta_label: null, cta_action: null,
    };
  }
  if (status === "client") {
    return {
      action: "fideliser", label: "Client", priority: 5,
      reason: "Affaire gagnée — pense à la fidélisation et aux opportunités d'upsell.",
      cta_label: null, cta_action: null,
    };
  }

  // ── Relance planifiée échue ─────────────────────────────────────────────────
  // Une relance prévue aujourd'hui ou en retard prime sur l'action de statut :
  // c'est un engagement concret pris lors d'un échange précédent.
  if (prospect.follow_up_at) {
    const today = new Date().toISOString().slice(0, 10);
    if (prospect.follow_up_at <= today) {
      const overdue = prospect.follow_up_at < today;
      return {
        action: "relance_prevue",
        label: overdue ? "Relance en retard" : "Relance prévue",
        priority: overdue ? 96 : 90,
        reason: prospect.next_action
          ? `Relance prévue le ${prospect.follow_up_at}${overdue ? " (en retard)" : ""} : ${prospect.next_action}`
          : `Relance prévue le ${prospect.follow_up_at}${overdue ? " (en retard)" : ""}.`,
        cta_label: null, cta_action: null,
      };
    }
  }

  // ── Intéressé — pousser vers le RDV / le closing ────────────────────────────
  if (status === "interesse") {
    return {
      action: "prepare_rdv", label: "Avancer vers le RDV", priority: 95,
      reason: "Prospect intéressé — cale un rendez-vous, prépare les points clés et anticipe les objections.",
      cta_label: "Voir la recherche", cta_action: "research",
    };
  }

  // ── En cours — faire avancer l'échange ──────────────────────────────────────
  if (status === "en_cours") {
    const urgent = (research?.signals || []).filter((s) => URGENT_TYPES.has(s.type));
    return {
      action: "avancer", label: "Faire avancer l'échange", priority: urgent.length ? 88 : 84,
      reason: urgent.length
        ? `Échange en cours et signal « ${urgent[0].type} » actif — capitalise dessus pour conclure.`
        : "Échange engagé — relance avec un angle concret pour qualifier le besoin.",
      cta_label: "Voir la recherche", cta_action: "research",
    };
  }

  // ── Contacté — relancer (pas encore de réponse) ─────────────────────────────
  if (status === "contacte") {
    const urgent = (research?.signals || []).filter((s) => URGENT_TYPES.has(s.type));
    if (urgent.length > 0) {
      return {
        action: "relance_urgente", label: "Relance urgente", priority: 82,
        reason: `Signal « ${urgent[0].type} » encore actif — la fenêtre d'opportunité se referme.`,
        cta_label: "Régénérer (triggered)", cta_action: "generate",
      };
    }
    return {
      action: "relance", label: "Relancer", priority: 65,
      reason: "Pas encore de réponse. Varie l'angle pour différencier la relance.",
      cta_label: "Régénérer les brouillons", cta_action: "generate",
    };
  }

  // ── Non contacté — préparer puis initier le 1er contact ─────────────────────
  // L'état de recherche se lit via la présence d'une recherche / de brouillons.
  if (!research) {
    const score = prospect.fit_score || 0;
    const priority = score >= 70 ? 78 : score >= 40 ? 62 : 44;
    const note = score >= 70 ? " Prospect hautement qualifié — priorité haute." : "";
    return {
      action: "rechercher", label: "Lancer la recherche", priority,
      reason: `Pas encore qualifié.${note} La recherche IA détecte les signaux d'achat et les angles d'accroche.`,
      cta_label: "Lancer la recherche", cta_action: "research",
    };
  }

  if (!drafts) {
    return {
      action: "generer", label: "Générer les brouillons", priority: 72,
      reason: "Recherche complète. Génère l'email, le message LinkedIn et les points d'appel.",
      cta_label: "Générer", cta_action: "generate",
    };
  }

  // Brouillons prêts — priorité au téléphone (règle #1 : la coordonnée la plus directe).
  if (hasPhone) {
    return {
      action: "appeler", label: "Appeler le prospect", priority: 74,
      reason: "Tout est prêt et un numéro est disponible — l'appel est le canal le plus direct.",
      cta_label: "Voir les points d'appel", cta_action: "drafts",
    };
  }
  if (!hasEmail) {
    return {
      action: "enrichir", label: "Trouver l'email", priority: 64,
      reason: "Brouillons prêts mais ni téléphone ni email — enrichis le contact.",
      cta_label: "Enrichir l'email", cta_action: "enrich",
    };
  }
  return {
    action: "envoyer", label: "Envoyer le 1er message", priority: 70,
    reason: "Tout est prêt. Copie le brouillon et envoie depuis ta messagerie.",
    cta_label: "Voir les brouillons", cta_action: "drafts",
  };
}
