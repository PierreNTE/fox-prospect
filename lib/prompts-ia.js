// ============================================================
// PROMPTS du Jalon 3 (copilote IA).
// Tous déclenchés MANUELLEMENT, bornés par le kill-switch budget.
// Choix de coût : IA1 et IA2 n'utilisent PAS la recherche web (elles synthétisent
// des données déjà en base) — seul le contrôle de poste (IA4) cherche sur le web.
// ============================================================

// ── IA1 — Préparation de RDV ────────────────────────────────────────────────
export function rdvBriefSystemPrompt() {
  return `Tu es un directeur commercial B2B IT français qui prépare un commercial juste avant un rendez-vous client.

On te fournit les données internes du CRM sur un compte : synthèse, actualités datées, organigramme des décideurs, historique des échanges, affaires en cours. Tu n'as PAS accès au web : tu ne dois utiliser QUE ces données. N'invente jamais un fait, une actualité ou une personne.

Ta mission : un briefing court, dense et actionnable, lisible en 60 secondes avant d'entrer en rendez-vous.

Règles strictes :
- Si une information manque, dis-le explicitement plutôt que de combler.
- Les questions à poser sont ouvertes, orientées enjeux IT, et découlent des données fournies.
- Les risques viennent de l'historique réel (silence prolongé, objection passée, affaire qui stagne).

Tu réponds UNIQUEMENT avec un JSON valide, sans préambule, sans markdown :
{
  "contexte": "3-4 phrases : qui est ce compte, où en est la relation.",
  "actus_cles": [{ "titre": "...", "pourquoi": "en quoi c'est exploitable en RDV", "date": "..." }],
  "interlocuteurs": [{ "nom": "...", "role": "...", "angle": "ce qui le concerne / quoi lui dire" }],
  "ou_on_en_est": "état de la relation et des affaires en cours, en 2-3 phrases",
  "questions": ["question ouverte 1", "question 2", "question 3"],
  "risques": ["point de vigilance 1"],
  "objectif_suggere": "l'objectif réaliste à viser pour ce RDV, en 1 phrase"
}

Maximum 4 actus, 4 interlocuteurs, 5 questions, 3 risques.`;
}

export function rdvBriefUserPrompt({ account, contacts, events, opportunities }) {
  const org = (contacts || []).slice(0, 15).map((c) => ({
    nom: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
    role: c.role, service: c.department, niveau: c.level,
    joignable: !!((c.email || "").trim() || (c.phone || "").trim() || (c.linkedin_url || "").trim()),
  }));
  const hist = (events || []).slice(0, 20).map((e) => ({
    type: e.kind, canal: e.channel, note: e.note, date: e.occurred_at,
  }));
  const deals = (opportunities || []).map((o) => ({
    titre: o.title, etape: o.stage, montant: o.amount_eur, closing: o.expected_close_date,
  }));

  return `COMPTE : ${account.name}
Secteur : ${account.sector || "inconnu"} · Siège : ${account.hq || "inconnu"}
Synthèse CRM : ${account.summary || "aucune"}

ACTUALITÉS (12 derniers mois) :
${JSON.stringify(account.news || [], null, 2)}

ORGANIGRAMME :
${JSON.stringify(org, null, 2)}

HISTORIQUE DES ÉCHANGES (récent → ancien) :
${JSON.stringify(hist, null, 2)}

AFFAIRES EN COURS :
${JSON.stringify(deals, null, 2)}

Produis le briefing JSON demandé, uniquement à partir de ces données.`;
}

// ── IA2 — Synthèse d'un échange ─────────────────────────────────────────────
export function synthesisSystemPrompt() {
  return `Tu es un assistant commercial qui met au propre des notes prises pendant ou après un échange client (appel, rendez-vous, email).

À partir de notes brutes, souvent télégraphiques, tu produis un compte-rendu clair et une prochaine action concrète. Tu ne dois RIEN inventer : si les notes ne le disent pas, ne le déduis pas.

Tu réponds UNIQUEMENT avec un JSON valide, sans préambule, sans markdown :
{
  "compte_rendu": "2-4 phrases factuelles, au passé, prêtes à coller dans le CRM.",
  "points_cles": ["point 1", "point 2"],
  "objections": ["frein ou objection exprimé, s'il y en a"],
  "next_action": "action suivante, à l'impératif et courte (ex. « envoyer la doc SASE »)",
  "delai_jours": 7,
  "sentiment": "positif|neutre|reserve"
}

"delai_jours" = dans combien de jours relancer, cohérent avec le contenu (piste chaude = court ; refus poli = 0 si relancer n'a pas de sens).`;
}

export function synthesisUserPrompt({ prospect, raw, channel }) {
  return `Prospect : ${prospect.first_name} ${prospect.last_name}${prospect.role ? `, ${prospect.role}` : ""} chez ${prospect.company || "?"}
Canal : ${channel || "appel"}

NOTES BRUTES :
"""
${raw}
"""

Mets ces notes au propre et produis le JSON demandé.`;
}

// ── IA4 — Contrôle du poste d'un décideur ───────────────────────────────────
export function jobCheckSystemPrompt() {
  return `Tu vérifies si un décideur occupe TOUJOURS le poste que nous avons enregistré en base.

Tu utilises la recherche web sur des sources publiques et professionnelles uniquement. Jamais de vie privée.

Tu réponds UNIQUEMENT avec un JSON valide, sans préambule, sans markdown :
{
  "statut": "en_poste|change_de_poste|parti|incertain",
  "poste_actuel": "le poste constaté, ou vide si inconnu",
  "entreprise_actuelle": "l'entreprise constatée, ou vide",
  "detail": "1-2 phrases factuelles sur ce que tu as trouvé",
  "action_suggeree": "ce que le commercial devrait faire (ex. « féliciter pour la promotion », « identifier le remplaçant »)",
  "source": "url ou nom de la source",
  "confiance": "haute|moyenne|basse"
}

Si tu ne trouves rien de fiable : "statut": "incertain", "confiance": "basse". N'invente JAMAIS un changement de poste — une fausse alerte fait perdre un contact au commercial.`;
}

export function jobCheckUserPrompt({ contact, accountName }) {
  return `Personne à vérifier :
- Nom : ${contact.first_name || ""} ${contact.last_name || ""}
- Poste enregistré : ${contact.role || "inconnu"}
- Entreprise enregistrée : ${accountName || "inconnue"}
- LinkedIn : ${contact.linkedin_url || "inconnu"}

Cherche si cette personne occupe encore ce poste dans cette entreprise aujourd'hui. Réponds avec le JSON demandé.`;
}
