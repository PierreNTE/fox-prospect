"""Étage 1 de la cascade — filtre lexical et codes CPV.

C'est l'étage le plus important du pipeline sur le plan économique : il écarte
l'essentiel du volume AVANT l'embedding et avant tout appel au LLM. Un filtre
trop laxiste fait exploser le budget ; un filtre trop sévère rend le module
inutile. D'où la conservation des documents écartés en base, avec leur motif :
sans elle, on ne peut pas mesurer si le réglage est bon.

Aucune dépendance lourde ici : de la comparaison de chaînes.
"""

import re
import unicodedata
from functools import lru_cache
from pathlib import Path

import yaml

TAXONOMIE = Path(__file__).resolve().parent.parent / "taxonomie"


@lru_cache(maxsize=1)
def _charger(nom):
    with open(TAXONOMIE / nom, encoding="utf-8") as f:
        return yaml.safe_load(f)


def normaliser(texte):
    """Minuscules, sans accents — pour comparer « sécurité » et « securite »."""
    if not texte:
        return ""
    sans_accent = unicodedata.normalize("NFD", str(texte))
    sans_accent = "".join(c for c in sans_accent if unicodedata.category(c) != "Mn")
    return " ".join(sans_accent.lower().split())


@lru_cache(maxsize=1024)
def _motif(terme):
    """Terme du dictionnaire → motif à FRONTIÈRES DE MOT.

    La comparaison par sous-chaîne est le piège classique du filtre lexical, et
    il s'est refermé : « san » (Storage Area Network) se trouve à l'intérieur
    de mots français courants, ce qui a fait classer un communiqué de résultats
    trimestriels de TotalEnergies en « projet datacenter ». Sur une fiche
    client, ce signal aurait été lu comme une opportunité ISG.

    Les frontières sont exprimées en lookaround plutôt qu'en \\b : certains
    termes du dictionnaire se terminent par un caractère non alphanumérique
    (« .net », « c# »), pour lesquels \\b ne se place pas où l'on croit.
    """
    n = normaliser(terme)
    # Le « s » optionnel évite la régression inverse : sans lui, « datacenter »
    # cesserait de reconnaître « datacenters », que la comparaison par
    # sous-chaîne attrapait. Resserrer la détection ne doit pas la trouer.
    #
    # Mais il ne vaut PAS pour les termes courts : accordé aux acronymes, il
    # faisait reconnaître « san » (Storage Area Network) dans « sans ». Un
    # sigle de trois lettres n'a de toute façon pas de pluriel utile.
    pluriel = "s?" if len(n) >= 5 else ""
    return re.compile(rf"(?<![a-z0-9]){re.escape(n)}{pluriel}(?![a-z0-9])")


def _contient(texte_normalise, termes):
    return any(_motif(t).search(texte_normalise) for t in termes)


# ── Codes CPV ───────────────────────────────────────────────────────────────

def ligne_produit_cpv(codes):
    """Ligne de produit déduite des codes CPV, préfixe le plus long gagnant.

    Renvoie None si aucun code ne correspond — le filtre lexical prendra alors
    le relais.
    """
    table = _charger("cpv.yaml")["prefixes"]
    meilleures = []
    for code in codes or []:
        gagnant, longueur = None, -1
        for prefixe, ligne in table.items():
            if str(code).startswith(prefixe) and len(prefixe) > longueur:
                gagnant, longueur = ligne, len(prefixe)
        if gagnant:
            meilleures.append(gagnant)

    if not meilleures:
        return None
    pertinentes = [m for m in meilleures if m != "none"]
    if not pertinentes:
        return "none"
    if "csg" in pertinentes and "isg" in pertinentes:
        return "both"
    # Une ligne précise l'emporte sur « both », qui n'est qu'un défaut prudent.
    for prioritaire in ("csg", "isg"):
        if prioritaire in pertinentes:
            return prioritaire
    return "both"


def est_informatique(codes):
    """Garde-fou : l'avis relève-t-il d'une famille CPV informatique ?"""
    familles = _charger("cpv.yaml")["familles_it"]
    return any(str(c).startswith(f) for c in (codes or []) for f in familles)


# ── Filtre lexical ──────────────────────────────────────────────────────────

def categoriser(texte):
    """Catégories du dictionnaire présentes dans le texte.

    Renvoie [(categorie, ligne_produit), …], vide si aucune correspondance.
    """
    d = _charger("dictionnaires.yaml")
    t = normaliser(texte)
    if not t:
        return []
    if _contient(t, d.get("exclusions", [])):
        return []
    return [
        (nom, bloc.get("ligne"))
        for nom, bloc in d["categories"].items()
        if _contient(t, bloc["termes"])
    ]


def detecter_concurrent(texte):
    """Concurrent identifié dans le texte, ou None.

    Se reconnaître soi-même compte : un marché gagné par Dell n'est pas un
    signal concurrentiel mais un compte client à suivre.
    """
    t = normaliser(texte)
    if not t:
        return None
    for marque, variantes in _charger("dictionnaires.yaml")["concurrents"].items():
        if _contient(t, variantes):
            return marque
    return None


# ── Décision ────────────────────────────────────────────────────────────────

def evaluer(document):
    """Décide du sort d'un document.

    Renvoie (retenu: bool, motif: str, categories: list, ligne_produit: str|None).
    Le motif est stocké en base pour rendre le réglage du filtre mesurable.
    """
    raw = document.get("raw") or {}
    cpv = raw.get("cpv") or []
    texte = f"{document.get('title', '')} {document.get('excerpt', '')}"

    # Avis d'attribution : le titulaire prime sur le sujet. Même si l'objet du
    # marché est banal, savoir qu'un concurrent vient de gagner est un signal.
    if raw.get("est_attribution") and detecter_concurrent(raw.get("winner_name", "")):
        return True, "attribution a un concurrent", ["concurrence"], ligne_produit_cpv(cpv)

    if cpv and not est_informatique(cpv):
        return False, "cpv hors perimetre informatique", [], None

    ligne_cpv = ligne_produit_cpv(cpv)
    if ligne_cpv == "none":
        return False, "cpv explicitement hors perimetre", [], None

    categories = categoriser(texte)
    if categories:
        lignes = {l for _, l in categories if l and l != "both"}
        ligne = ligne_cpv or (lignes.pop() if len(lignes) == 1 else "both")
        return True, "mot-cle taxonomie", [c for c, _ in categories], ligne

    # Un avis TED classé dans une famille informatique reste pertinent même sans
    # mot-clé : le CPV est une classification officielle, plus fiable qu'un
    # dictionnaire.
    if ligne_cpv:
        return True, "cpv informatique", ["appel_offres"], ligne_cpv

    return False, "aucun signal detecte", [], None
