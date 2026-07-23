// Modèles de cadences de relance (FV5) — purs. Lancer une séquence sur un
// prospect crée des tâches datées (table `tasks`, migration v9) : multi-canal,
// espacé, SANS envoi automatique (le commercial reste maître de chaque geste).
//
// `day` = décalage en jours par rapport au lancement. `kind` = canal (aligné sur
// les types de tâches). Éditer/enrichir ces modèles est un simple ajout ici.

export const SEQUENCE_TEMPLATES = [
  {
    key: "prospection_froid",
    label: "Prospection à froid",
    description: "Premier contact multicanal sur 2 semaines",
    steps: [
      { day: 0, kind: "email", title: "Email d'accroche" },
      { day: 3, kind: "linkedin", title: "Connexion + message LinkedIn" },
      { day: 7, kind: "appel", title: "Appel de relance" },
      { day: 14, kind: "email", title: "Email de relance (dernier)" },
    ],
  },
  {
    key: "relance_apres_rdv",
    label: "Relance après RDV",
    description: "Maintenir le momentum après un premier rendez-vous",
    steps: [
      { day: 1, kind: "email", title: "Compte-rendu + prochaines étapes" },
      { day: 5, kind: "appel", title: "Appel de suivi" },
      { day: 12, kind: "email", title: "Relance sur la proposition" },
    ],
  },
  {
    key: "reactivation",
    label: "Réactivation compte dormant",
    description: "Relancer un compte sans échange récent",
    steps: [
      { day: 0, kind: "linkedin", title: "Reprise de contact LinkedIn" },
      { day: 4, kind: "email", title: "Email avec une actualité du compte" },
      { day: 10, kind: "appel", title: "Appel" },
    ],
  },
];

export function findTemplate(key) {
  return SEQUENCE_TEMPLATES.find((t) => t.key === key) || null;
}
