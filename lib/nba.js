// Next Best Action — déterministe, sans LLM.
// Prend les données disponibles en mémoire et détermine la prochaine action prioritaire.

const URGENT_TYPES = new Set(["rfp_it", "incident", "recrutement"]);

/**
 * @param {{ prospect: object, research?: object|null, drafts?: object|null }} opts
 * @returns {{ action: string, label: string, priority: number, reason: string, cta_label: string|null, cta_action: string|null }}
 */
export function computeNba({ prospect, research = null, drafts = null } = {}) {
  const status = prospect.status || "nouveau";

  // ── Statuts terminaux ──────────────────────────────────────────────────────
  if (status === "opt-out") {
    return {
      action: "opt_out", label: "Opt-out", priority: 0,
      reason: "Contact en opposition permanente — ne pas recontacter.",
      cta_label: null, cta_action: null,
    };
  }
  if (status === "perdu") {
    return {
      action: "archive", label: "Perdu", priority: 0,
      reason: "Opportunité fermée.",
      cta_label: null, cta_action: null,
    };
  }

  // ── RDV confirmé ──────────────────────────────────────────────────────────
  if (status === "rdv") {
    return {
      action: "prepare_rdv", label: "Préparer le RDV", priority: 95,
      reason: "RDV confirmé — relis les signaux, prépare les points clés et anticipe les objections.",
      cta_label: "Voir la recherche", cta_action: "research",
    };
  }

  // ── Réponse reçue ─────────────────────────────────────────────────────────
  if (status === "répondu") {
    return {
      action: "confirm_rdv", label: "Qualifier la réponse", priority: 88,
      reason: "Réponse reçue — propose un créneau ou confirme le rendez-vous.",
      cta_label: null, cta_action: null,
    };
  }

  // ── Contacté — relance ────────────────────────────────────────────────────
  if (status === "contacté") {
    const urgentSignals = (research?.signals || []).filter((s) => URGENT_TYPES.has(s.type));
    if (urgentSignals.length > 0) {
      return {
        action: "relance_urgente", label: "Relance urgente", priority: 82,
        reason: `Signal "${urgentSignals[0].type}" encore actif — la fenêtre d'opportunité se referme.`,
        cta_label: "Régénérer (triggered)", cta_action: "generate",
      };
    }
    return {
      action: "relance", label: "Relancer", priority: 65,
      reason: "Pas encore de réponse. Varie l'angle pour différencier la relance.",
      cta_label: "Régénérer les brouillons", cta_action: "generate",
    };
  }

  // ── Recherché — génération / envoi ────────────────────────────────────────
  if (status === "recherché") {
    if (!drafts) {
      return {
        action: "generer", label: "Générer les brouillons", priority: 72,
        reason: "Recherche complète. Génère maintenant l'email, le message LinkedIn et les points d'appel.",
        cta_label: "Générer", cta_action: "generate",
      };
    }
    if (!prospect.email) {
      return {
        action: "enrichir", label: "Trouver l'email", priority: 64,
        reason: "Brouillons prêts mais adresse email manquante — enrichis le contact.",
        cta_label: "Enrichir l'email", cta_action: "enrich",
      };
    }
    return {
      action: "envoyer", label: "Envoyer le message", priority: 70,
      reason: "Tout est prêt. Copie le brouillon et envoie depuis ta messagerie.",
      cta_label: "Voir les brouillons", cta_action: "drafts",
    };
  }

  // ── Nouveau — recherche + cycle standard ──────────────────────────────────
  const score = prospect.fit_score || 0;

  if (!research) {
    // Priorité proportionnelle au score : plus le score est élevé, plus c'est urgent.
    const priority = score >= 70 ? 78 : score >= 40 ? 62 : 44;
    const urgencyNote = score >= 70 ? " Ce prospect est hautement qualifié — priorité haute." : "";
    return {
      action: "rechercher", label: "Lancer la recherche", priority,
      reason: `Prospect non qualifié.${urgencyNote} La recherche IA détecte les signaux d'achat et les angles d'accroche.`,
      cta_label: "Lancer la recherche", cta_action: "research",
    };
  }

  if (!drafts) {
    return {
      action: "generer", label: "Générer les brouillons", priority: 62,
      reason: "Recherche disponible. Génère les accroches personnalisées.",
      cta_label: "Générer", cta_action: "generate",
    };
  }

  return {
    action: "envoyer", label: "Envoyer", priority: 55,
    reason: "Brouillons générés. Envoie depuis ta messagerie habituelle.",
    cta_label: "Voir les brouillons", cta_action: "drafts",
  };
}
