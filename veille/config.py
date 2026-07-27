"""Configuration du pipeline de veille.

Tout vient de l'environnement : aucune valeur sensible n'est écrite ici, et
`veille_sources` en base ne contient jamais de secret non plus.
"""

import os
import sys

SB_URL = os.environ.get("SUPABASE_URL")
SB_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def exiger_supabase():
    """Échoue tôt et clairement plutôt qu'au premier appel REST."""
    if not SB_URL or not SB_KEY:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY requis (secrets GitHub Actions).")


def _env(nom, defaut):
    """Valeur d'environnement, la chaîne VIDE valant absence.

    `os.environ.get(nom, defaut)` ne suffit pas ici. GitHub Actions exporte
    `FOO: ${{ vars.FOO }}` comme chaîne vide quand la variable de dépôt n'existe
    pas : la clé EST présente dans l'environnement, le défaut n'est donc jamais
    servi, et `int("")` lève.

    Ce n'était pas théorique. Le passage du 27 juillet (run 30240731757) est
    mort en 20 secondes sur `int('')` à l'import de ce module — donc avant toute
    collecte, et pour la seule raison qu'aucune des six variables facultatives
    du workflow n'était définie. Les valeurs par défaut de ce fichier étaient
    inatteignables depuis GitHub Actions.
    """
    valeur = os.environ.get(nom)
    return defaut if valeur is None or valeur.strip() == "" else valeur.strip()


# ── Plafonds ────────────────────────────────────────────────────────────────
# Seconde barrière derrière le kill-switch mensuel de lib/budget.js : celui-ci
# protège le mois, il ne protège pas d'une source qui déverserait des milliers
# de documents ambigus en une nuit.

MAX_LLM_PAR_PASSAGE = int(_env("VEILLE_MAX_LLM", "20"))
MAX_DOCS_PAR_SOURCE = int(_env("VEILLE_MAX_DOCS", "400"))

# Fenêtre de collecte. 2 jours et non 1 : un passage quotidien qui échoue ne
# doit pas créer un trou définitif dans l'historique. La contrainte d'unicité
# sur url_hash rend ce recouvrement sans effet de bord.
FENETRE_JOURS = int(_env("VEILLE_FENETRE_JOURS", "2"))

# Fenêtre des SALLES DE PRESSE (flux rattachés à un compte).
#
# Une fenêtre unique de 2 jours convient à TED, qui publie des centaines d'avis
# par jour ; elle est inadaptée à la salle de presse d'un grand compte, qui
# publie quelques fois par mois. Mesuré le 26 juillet sur les cinq flux
# rattachés : le communiqué le plus récent avait 3 jours (Atos, Stellantis,
# TotalEnergies), 6 jours (AXA), 38 jours (Crédit Agricole). Aucun n'entrait
# dans la fenêtre — la veille sur ces comptes était donc structurellement
# aveugle, alors que ce sont les seuls flux dont le rattachement est certain.
#
# Le recouvrement ne coûte rien : l'unicité d'url_hash écarte les doublons, et
# ces flux comptent quelques dizaines d'entrées, pas des milliers.
FENETRE_JOURS_PRESSE = int(_env("VEILLE_FENETRE_PRESSE", "21"))

# Seuil de similarité pour le rattachement par nom (0-1). Volontairement haut :
# un faux rattachement coûte plus cher qu'un signal manqué.
SEUIL_RAPPROCHEMENT_NOM = float(_env("VEILLE_SEUIL_NOM", "0.86"))

# Pays du MVP. L'Allemagne est couverte par TED et la presse uniquement.
# Les entrées vides sont retirées : `"FRA,,GBR".split(",")` produirait un code
# pays vide, que TED interprète comme une requête sans filtre de pays.
PAYS_MVP = [p.strip().upper() for p in _env("VEILLE_PAYS", "FRA,DEU,GBR").split(",") if p.strip()]

# Identifiant d'exécution GitHub Actions, journalisé dans pipeline_runs.
RUN_REF = _env("GITHUB_RUN_ID", "local")


# ── Étage IA ────────────────────────────────────────────────────────────────
# Le pipeline partage la facture Anthropic de l'application : même clé, même
# table ai_runs, même plafond mensuel que lib/budget.js. Deux compteurs
# séparés donneraient deux vérités sur une seule facture.

ANTHROPIC_KEY = _env("ANTHROPIC_API_KEY", "")

# Haiku et non Sonnet : la tâche est de trancher un oui/non sur un texte court
# et de le résumer. Mesuré côté application, l'écart de tarif est d'un facteur
# dix pour un gain nul sur ce type de jugement.
MODELE_LLM = _env("VEILLE_MODELE_LLM", "claude-haiku-4-5-20251001")

# Tarifs en euros par million de jetons, alignés sur ANTHROPIC_TARIF de
# lib/constants.js. À corriger AUX DEUX ENDROITS si les tarifs changent.
TARIF_LLM = {"entree_par_m_eur": 0.25, "sortie_par_m_eur": 1.25}

BUDGET_MENSUEL_EUR = float(_env("MONTHLY_BUDGET_EUR", "15"))

# BGE-M3 : multilingue, 1024 dimensions — la valeur déclarée par la migration
# v12 (halfvec(1024)). Changer de modèle impose de changer la colonne.
MODELE_EMBED = _env("VEILLE_MODELE_EMBED", "BAAI/bge-m3")

# Plafond de volume par passage, qui est en réalité un plafond de temps : le
# runner dispose d'une trentaine de minutes, et c'est la seule étape dont la
# durée croît avec le volume collecté.
MAX_EMBED_PAR_PASSAGE = int(_env("VEILLE_MAX_EMBED", "400"))

# Fenêtre de conservation des vecteurs, en mois. Seul poste à croissance
# illimitée sous le palier gratuit de 500 Mo : ~55 000 vecteurs à 12 mois,
# soit ~165 Mo. Les signaux, eux, ne sont jamais purgés.
PURGE_MOIS = int(_env("VEILLE_PURGE_MOIS", "12"))
