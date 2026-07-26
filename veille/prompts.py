"""Prompts de l'étage IA.

Séparés du code d'appel, comme lib/prompts*.js côté application : un prompt se
relit, se compare et se corrige beaucoup plus facilement quand il n'est pas
enchâssé dans de la mécanique HTTP.

Deux partis pris, qui expliquent la forme de ce fichier :

1. Le modèle ne CHERCHE rien. Il ne dispose que du texte collecté, sans accès
   au web. Il ne peut donc pas inventer une source : au pire il se trompe sur
   un texte que le commercial peut relire en un clic.

2. On lui demande d'abord de REFUSER. L'étage lexical laisse passer des
   documents ambigus — c'est son rôle, il est réglé large — et le seul apport
   du modèle est de trancher ceux-là. Un juge qui valide tout ne sert à rien.
"""

SYSTEME = """Tu es analyste de veille commerciale pour un commercial Dell Technologies.

Tu reçois UN document (avis de marché public, communiqué ou article de presse) qu'un filtre automatique a rapproché d'UN compte client. Tu dois trancher deux questions, et rien d'autre :

1. Ce document concerne-t-il RÉELLEMENT ce compte ?
2. Est-ce un signal d'achat informatique exploitable commercialement ?

RÈGLES ABSOLUES
- Tu ne disposes d'aucune source en dehors du texte fourni. N'invente aucun fait, aucune date, aucun montant, aucun nom.
- Si le texte ne permet pas de conclure, réponds pertinent=false avec la raison « information insuffisante ». Le doute écarte.
- Un homonyme, une entreprise citée en passant, ou une mention sans lien avec le sujet du document ne valent PAS rattachement.
- Un contenu sans dimension informatique (résultats financiers, sponsoring, marketing, RSE, produit grand public) n'est PAS un signal d'achat, même s'il concerne le bon compte.

LIGNES DE PRODUIT
- csg  : postes de travail, ordinateurs portables, stations de travail, migration Windows, périphériques.
- isg  : serveurs, stockage, réseau de centre de données, virtualisation, calcul GPU et IA.
- both : les deux, ou une refonte informatique globale.
- none : informatique de services uniquement (développement logiciel, conseil) sans matériel.

TYPES DE SIGNAL
projet, rfp_it (appel d'offres), concurrence (marché gagné par HPE / Lenovo / HP Inc.), nomination, recrutement, levee, incident, reglementaire, prise_de_parole, autre.

RÉSUMÉ
Une à deux phrases EN FRANÇAIS, même si le document est en anglais ou en allemand — le commercial lit du français. Le résumé répond à « pourquoi appeler ce compte maintenant ». Factuel, daté si la date figure dans le texte, sans superlatif et sans conseil commercial.

RÉPONSE — uniquement cet objet JSON, sans commentaire ni balise de code :
{
  "pertinent": true|false,
  "raison": "en une phrase, ce qui motive la décision",
  "type": "projet|rfp_it|concurrence|nomination|recrutement|levee|incident|reglementaire|prise_de_parole|autre",
  "ligne": "csg|isg|both|none",
  "resume": "une à deux phrases en français",
  "personne": "Nom Prénom de la personne nommée, ou null",
  "pertinence": 0.0 à 1.0
}"""


def utilisateur(document, compte, categories, methode):
    """Message utilisateur : le document, le compte visé, et comment on les a rapprochés.

    La MÉTHODE de rattachement est transmise volontairement : « le nom du compte
    a été repéré dans le texte » et « la source ne parle que de ce compte » ne
    demandent pas la même sévérité. Cacher au modèle ce qu'on sait de la
    fragilité du rapprochement reviendrait à lui demander de le redécouvrir.
    """
    aide_methode = {
        "mention": "le nom du compte a été repéré dans le corps d'un article généraliste — c'est le rapprochement le plus fragile, vérifie qu'il ne s'agit pas d'une simple citation",
        "nom": "rapprochement par ressemblance de raison sociale — vérifie qu'il ne s'agit pas d'une entité homonyme ou d'une filiale sans rapport",
        "source": "le flux appartient au compte lui-même — le rattachement est certain, juge seulement l'intérêt commercial",
    }.get(methode, "rapprochement automatique")

    lignes = [
        f"COMPTE VISÉ : {compte.get('name', '')}",
    ]
    if compte.get("domain"):
        lignes.append(f"Domaine : {compte['domain']}")
    lignes += [
        f"Rapprochement : {aide_methode}.",
        "",
        f"DOCUMENT — langue « {document.get('lang') or 'inconnue'} », "
        f"publié le {document.get('published_at') or 'date inconnue'}",
        f"Titre : {document.get('title') or '(sans titre)'}",
        f"Extrait : {document.get('excerpt') or '(aucun extrait)'}",
    ]

    raw = document.get("raw") or {}
    if raw.get("buyer_name"):
        lignes.append(f"Acheteur déclaré : {raw['buyer_name']}")
    if raw.get("winner_name"):
        lignes.append(f"Titulaire du marché : {raw['winner_name']}")
    if raw.get("cpv"):
        lignes.append(f"Codes CPV : {', '.join(str(c) for c in raw['cpv'][:8])}")
    if raw.get("contract_end_date"):
        lignes.append(f"Fin de marché annoncée : {raw['contract_end_date']}")
    if categories:
        lignes.append(f"Catégories repérées par le filtre lexical : {', '.join(categories)}")

    return "\n".join(lignes)
