"""Résolution d'entités — rattacher un document au bon compte du CRM.

Cascade déterministe, de la méthode la plus fiable à la moins fiable :
    LEI → identifiant de registre → domaine → similarité de nom

Le point non négociable : la MÉTHODE et la CONFIANCE sont renvoyées avec le
résultat, stockées en base et affichées dans l'interface. Un rattachement par
similarité de nom ne doit jamais se présenter avec la même assurance qu'un
rattachement par identifiant officiel.

Pas de Splink au MVP : avec quelques dizaines de comptes, une cascade explicite
est plus juste, plus rapide et surtout débogable. Le déclencheur de bascule est
mesuré, pas supposé — voir le benchmark (livrable 1).
"""

import difflib
import re
import unicodedata

from config import SEUIL_RAPPROCHEMENT_NOM

# Formes juridiques et mots vides qui n'apportent rien à l'identification.
# « Société Générale SA » et « Societe Generale » doivent se rapprocher.
BRUIT = {
    "sa", "sas", "sarl", "sasu", "se", "sca", "snc", "eurl", "scop",
    "gmbh", "ag", "kg", "mbh", "ug", "ohg",
    "ltd", "plc", "llp", "limited", "inc", "corp",
    "groupe", "group", "holding", "france", "deutschland", "uk",
    "et", "and", "de", "du", "des", "la", "le", "les",
}


def normaliser(texte):
    if not texte:
        return ""
    t = unicodedata.normalize("NFD", str(texte))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9]+", " ", t.lower())
    return " ".join(t.split())


def cle_nom(nom):
    """Forme comparable d'une raison sociale, débarrassée du bruit juridique."""
    mots = [m for m in normaliser(nom).split() if m not in BRUIT and len(m) > 1]
    return " ".join(mots)


def domaine_de(url_ou_domaine):
    """« https://www.acme.fr/contact » → « acme.fr »."""
    if not url_ou_domaine:
        return ""
    d = re.sub(r"^https?://", "", str(url_ou_domaine).strip().lower())
    d = d.split("/")[0].split("?")[0]
    return d[4:] if d.startswith("www.") else d


class Annuaire:
    """Index des comptes suivis, construit une fois par passage.

    Avec quelques dizaines à quelques centaines de comptes, tout tient en
    mémoire : inutile d'aller chercher pg_trgm côté base pour chaque document.
    """

    def __init__(self, comptes):
        self.comptes = comptes
        self.par_domaine = {}
        self.par_nom = {}
        for c in comptes:
            d = domaine_de(c.get("domain"))
            if d:
                self.par_domaine[d] = c
            k = cle_nom(c.get("name"))
            if k:
                self.par_nom[k] = c
        self._cles = list(self.par_nom)

    def resoudre(self, nom=None, domaine=None):
        """Renvoie (compte|None, methode, confiance)."""
        # 1. Domaine — fiable, y compris pour les sous-domaines.
        d = domaine_de(domaine)
        if d:
            if d in self.par_domaine:
                return self.par_domaine[d], "domaine", 0.95
            for connu, compte in self.par_domaine.items():
                if d.endswith("." + connu):
                    return compte, "domaine", 0.90

        if not nom:
            return None, None, 0.0

        cle = cle_nom(nom)
        if not cle:
            return None, None, 0.0

        # 2. Nom exact après nettoyage — très fiable.
        if cle in self.par_nom:
            return self.par_nom[cle], "nom", 0.92

        # 3. Similarité. Seuil volontairement haut : un faux rattachement coûte
        #    plus cher qu'un signal manqué, parce qu'il pollue une fiche compte
        #    avec une information fausse que le commercial croira vraie.
        proches = difflib.get_close_matches(cle, self._cles, n=1, cutoff=SEUIL_RAPPROCHEMENT_NOM)
        if proches:
            score = difflib.SequenceMatcher(None, cle, proches[0]).ratio()
            return self.par_nom[proches[0]], "nom", round(score, 2)

        return None, None, 0.0


def rattacher(document, annuaire):
    """Rattache un document TED à un compte suivi, via l'acheteur public.

    Le titulaire du marché n'est délibérément PAS utilisé pour le rattachement :
    quand HPE gagne chez un hôpital, le compte concerné est l'hôpital, pas HPE.
    """
    raw = document.get("raw") or {}
    return annuaire.resoudre(nom=raw.get("buyer_name"), domaine=raw.get("buyer_domain"))
