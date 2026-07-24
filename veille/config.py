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


# ── Plafonds ────────────────────────────────────────────────────────────────
# Seconde barrière derrière le kill-switch mensuel de lib/budget.js : celui-ci
# protège le mois, il ne protège pas d'une source qui déverserait des milliers
# de documents ambigus en une nuit.

MAX_LLM_PAR_PASSAGE = int(os.environ.get("VEILLE_MAX_LLM", "20"))
MAX_DOCS_PAR_SOURCE = int(os.environ.get("VEILLE_MAX_DOCS", "400"))

# Fenêtre de collecte. 2 jours et non 1 : un passage quotidien qui échoue ne
# doit pas créer un trou définitif dans l'historique. La contrainte d'unicité
# sur url_hash rend ce recouvrement sans effet de bord.
FENETRE_JOURS = int(os.environ.get("VEILLE_FENETRE_JOURS", "2"))

# Seuil de similarité pour le rattachement par nom (0-1). Volontairement haut :
# un faux rattachement coûte plus cher qu'un signal manqué.
SEUIL_RAPPROCHEMENT_NOM = float(os.environ.get("VEILLE_SEUIL_NOM", "0.86"))

# Pays du MVP. L'Allemagne est couverte par TED et la presse uniquement.
PAYS_MVP = os.environ.get("VEILLE_PAYS", "FRA,DEU,GBR").split(",")

# Identifiant d'exécution GitHub Actions, journalisé dans pipeline_runs.
RUN_REF = os.environ.get("GITHUB_RUN_ID", "local")
