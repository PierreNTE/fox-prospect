"""Étage 3 — jugement par le modèle. Dernier maillon, jamais le premier.

Le filtre lexical décide du VOLUME, ce module décide de la QUALITÉ. Il ne voit
qu'une poignée de documents par passage : ceux dont le rattachement est fragile
(nom repéré dans un article) ou dont l'énoncé est étranger. Sur les autres —
salle de presse d'un compte, avis nominatif d'un acheteur public — le modèle
n'apporterait rien qu'on ne sache déjà, et coûterait.

Trois barrières de dépense, dans cet ordre :
  1. la sélection ci-dessus, qui détermine combien de documents sont éligibles ;
  2. MAX_LLM_PAR_PASSAGE, plafond dur par exécution ;
  3. le budget mensuel en euros, lu dans ai_runs — le même compteur que
     lib/budget.js côté application, pour qu'il n'existe qu'UNE facture et un
     seul plafond, quelle que soit la moitié du système qui dépense.

Une réponse inexploitable ou un appel en échec ne fait pas tomber le passage :
le signal est alors écrit sans jugement, exactement comme avant cet étage.
"""

import json
import time
import urllib.error
import urllib.request

import db
import prompts
from config import (ANTHROPIC_KEY, BUDGET_MENSUEL_EUR, MAX_LLM_PAR_PASSAGE,
                   MODELE_LLM, TARIF_LLM)

API = "https://api.anthropic.com/v1/messages"

# Méthodes de rattachement qui ne se trompent pas : la source appartient au
# compte, ou l'entité est nommée dans un document officiel. Les soumettre au
# modèle serait payer pour confirmer une certitude.
METHODES_SURES = {"source", "lei", "siren", "registre", "domaine", "manuel"}

LIGNES_VALIDES = {"csg", "isg", "both", "none"}
TYPES_VALIDES = {
    "projet", "rfp_it", "concurrence", "nomination", "recrutement",
    "levee", "incident", "reglementaire", "prise_de_parole", "autre",
}


def _cout_eur(usage):
    entree = (usage or {}).get("input_tokens", 0)
    sortie = (usage or {}).get("output_tokens", 0)
    return (entree / 1e6) * TARIF_LLM["entree_par_m_eur"] + \
           (sortie / 1e6) * TARIF_LLM["sortie_par_m_eur"]


def _extraire_json(texte):
    """Isole l'objet JSON d'une réponse qui peut porter un préambule ou des fences.

    Même prudence que extractJson côté application : on borne à la première
    accolade et à la dernière, sans toucher au contenu.
    """
    t = (texte or "").strip()
    debut, fin = t.find("{"), t.rfind("}")
    if debut == -1 or fin <= debut:
        raise ValueError("aucun JSON dans la réponse")
    return json.loads(t[debut:fin + 1])


def _appeler(systeme, utilisateur, max_tokens=500, tentatives=3):
    """Appel Anthropic en stdlib, avec réessai sur saturation.

    Pas de SDK : la seule dépendance du passage quotidien qui vaille d'être
    payée en minutes d'installation est celle qui fait quelque chose
    d'irremplaçable, et une requête HTTP n'en fait pas partie.
    """
    corps = json.dumps({
        "model": MODELE_LLM,
        "max_tokens": max_tokens,
        "system": systeme,
        "messages": [{"role": "user", "content": utilisateur}],
    }).encode()

    for essai in range(1, tentatives + 1):
        req = urllib.request.Request(API, data=corps, method="POST", headers={
            "content-type": "application/json",
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode())
            texte = "".join(b.get("text", "") for b in data.get("content", [])
                            if b.get("type") == "text")
            return texte, data.get("usage") or {}
        except urllib.error.HTTPError as e:
            saturation = e.code in (429, 529)
            if not saturation or essai == tentatives:
                raise RuntimeError(f"Anthropic {e.code} : {e.read().decode()[:200]}")
            time.sleep(min(20, 5 * essai))
    raise RuntimeError("Anthropic : toutes les tentatives ont échoué")


class Juge:
    """Porte l'état de dépense du passage. Une instance par exécution.

    Construire l'objet suffit à connaître le verdict budgétaire : si le mois est
    déjà consommé, `disponible()` répond non dès le premier document, sans
    qu'aucun appelant n'ait à connaître la règle.
    """

    def __init__(self, dry_run=False):
        self.dry_run = dry_run
        self.appels = 0
        self.cout_eur = 0.0
        self.echecs = 0
        self.pannes_consecutives = 0
        self.restant = MAX_LLM_PAR_PASSAGE
        self.motif_indisponible = None

        if not ANTHROPIC_KEY:
            self.restant = 0
            self.motif_indisponible = "ANTHROPIC_API_KEY absente"
            return

        # Le budget est lu UNE fois : à vingt appels de Haiku par passage, la
        # dépense de l'exécution est négligeable devant le plafond mensuel, et
        # relire la somme entre chaque document coûterait plus de requêtes que
        # d'euros économisés. On ajoute simplement la dépense locale au fil de
        # l'eau pour couper si le plafond est franchi en cours de route.
        try:
            self.depense_mois = db.cout_mois_courant()
        except Exception as e:                       # base injoignable : on ne
            self.restant = 0                         # dépense pas à l'aveugle
            self.motif_indisponible = f"budget illisible ({e})"
            return

        if self.depense_mois >= BUDGET_MENSUEL_EUR:
            self.restant = 0
            self.motif_indisponible = (
                f"budget mensuel atteint ({self.depense_mois:.2f} / "
                f"{BUDGET_MENSUEL_EUR:.2f} €)"
            )

    def disponible(self):
        if self.restant <= 0:
            return False
        return (self.depense_mois + self.cout_eur) < BUDGET_MENSUEL_EUR

    def a_juger(self, methode):
        """Ce rattachement mérite-t-il un appel ? Voir METHODES_SURES."""
        return methode not in METHODES_SURES

    def juger(self, document, compte, categories, methode):
        """Verdict sur un document, ou None si l'appel n'a pas eu lieu.

        None n'est pas un rejet : c'est « non jugé ». L'appelant écrit alors le
        signal tel quel, avec sa provenance affichée comme « à vérifier » —
        le comportement d'avant cet étage.
        """
        if not self.disponible():
            return None

        if self.dry_run:
            self.appels += 1
            self.restant -= 1
            return None

        try:
            texte, usage = _appeler(
                prompts.SYSTEME,
                prompts.utilisateur(document, compte, categories, methode),
            )
        except Exception as e:
            self.echecs += 1
            self.pannes_consecutives += 1
            self.restant -= 1                     # un échec consomme le plafond
            print(f"    jugement impossible : {e}")
            # Coupe-circuit. Le mode de panne observé n'est pas l'appel qui rate
            # de temps en temps : c'est l'API indisponible pour la journée
            # entière (plafond de compte atteint, incident fournisseur). Sans
            # cette coupure, chaque document ambigu du passage ré-essaie et
            # ajoute sa latence pour le même échec.
            if self.pannes_consecutives >= 3:
                self.restant = 0
                self.motif_indisponible = "API en échec répété — étage coupé pour ce passage"
                print(f"    {self.motif_indisponible}")
            return None

        self.appels += 1
        self.restant -= 1
        self.pannes_consecutives = 0
        cout = _cout_eur(usage)
        self.cout_eur += cout

        # Journalisé dans ai_runs comme n'importe quel appel de l'application :
        # la jauge de budget affichée dans Réglages doit voir la veille.
        try:
            db.journaliser_ai_run(
                "veille-juge",
                account_id=compte.get("id"),
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
                cost_eur=round(cout, 5),
            )
        except Exception as e:
            print(f"    ai_runs non journalisé : {e}")

        try:
            return self._normaliser(_extraire_json(texte))
        except Exception as e:
            self.echecs += 1
            print(f"    réponse inexploitable : {e}")
            return None

    @staticmethod
    def _normaliser(verdict):
        """Ramène la réponse du modèle dans les valeurs que la base accepte.

        Le contrôle porte sur les ENUMS, pas sur le fond : une contrainte SQL
        violée fait échouer l'écriture du signal, et un passage de veille ne
        doit pas tomber parce qu'un modèle a écrit « RFP » au lieu de « rfp_it ».
        """
        pertinence = verdict.get("pertinence")
        try:
            pertinence = min(1.0, max(0.0, float(pertinence)))
        except (TypeError, ValueError):
            pertinence = None

        ligne = str(verdict.get("ligne") or "").lower()
        type_ = str(verdict.get("type") or "").lower()
        resume = (verdict.get("resume") or "").strip()
        personne = (verdict.get("personne") or None)

        return {
            "pertinent": bool(verdict.get("pertinent")),
            "raison": (verdict.get("raison") or "").strip()[:200],
            "ligne": ligne if ligne in LIGNES_VALIDES else None,
            "type": type_ if type_ in TYPES_VALIDES else None,
            "resume": resume[:1000] or None,
            "personne": str(personne)[:120] if personne else None,
            "pertinence": pertinence,
        }

    def bilan(self):
        # L'ordre compte : un étage tombé en panne ne doit jamais se présenter
        # comme un étage qui n'a rien eu à faire. C'est la différence entre
        # « rien d'ambigu aujourd'hui » et « la veille n'est plus jugée ».
        if self.echecs and not self.appels:
            return (f"jugement IA EN ÉCHEC — {self.echecs} tentative(s) : "
                    f"{self.motif_indisponible or 'voir les erreurs ci-dessus'}")
        if self.motif_indisponible and not self.appels:
            return f"jugement IA inactif — {self.motif_indisponible}"
        if not self.appels:
            return "jugement IA : aucun document ambigu"
        return (f"jugement IA : {self.appels} appel(s), {self.cout_eur:.4f} € "
                f"({self.echecs} échec(s))")
