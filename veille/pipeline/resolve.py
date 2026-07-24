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

# Formes juridiques : toujours retirées. « Société Générale SA » et
# « Societe Generale » doivent se rapprocher.
FORMES_JURIDIQUES = {
    "sa", "sas", "sarl", "sasu", "se", "sca", "snc", "eurl", "scop",
    "gmbh", "ag", "kg", "mbh", "ug", "ohg",
    "ltd", "plc", "llp", "limited", "inc", "corp",
    "groupe", "group", "holding",
}

# Articles et qualificatifs géographiques : retirés pour la COMPARAISON de deux
# raisons sociales, mais conservés pour la RECHERCHE dans un texte.
#
# La distinction n'est pas cosmétique : « La Poste », dépouillé de son article,
# devient « poste » — un mot omniprésent en français (« poste de travail »).
# Mesuré sur un échantillon de presse réel, cette seule confusion produisait
# cinq faux rattachements sur six signaux.
MOTS_FAIBLES = {
    "et", "and", "de", "du", "des", "la", "le", "les", "the",
    "france", "deutschland", "uk",
}

BRUIT = FORMES_JURIDIQUES | MOTS_FAIBLES


def normaliser(texte):
    if not texte:
        return ""
    t = unicodedata.normalize("NFD", str(texte))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9]+", " ", t.lower())
    return " ".join(t.split())


def cle_nom(nom):
    """Forme comparable d'une raison sociale, pour rapprocher deux noms."""
    mots = [m for m in normaliser(nom).split() if m not in BRUIT and len(m) > 1]
    return " ".join(mots)


def forme_recherche(nom):
    """Forme à chercher dans un texte : on ne retire QUE la forme juridique.

    « La Poste SA » → « la poste ». L'article est conservé : c'est lui qui
    distingue l'entreprise du nom commun.
    """
    mots = [m for m in normaliser(nom).split() if m not in FORMES_JURIDIQUES and len(m) > 1]
    return " ".join(mots)


def domaine_de(url_ou_domaine):
    """« https://www.acme.fr/contact » → « acme.fr ».

    Le champ `accounts.domain` est saisi à la main et contient des variantes :
    « axa.com / axa.fr », « renaultgroup.com (corporate) / renault.fr (marque) ».
    Découper naïvement sur « / » donnait « axa.com » suivi d'un espace, qui ne
    correspondait à rien — le rattachement par domaine échouait en silence sur
    ces comptes, sans qu'aucune erreur ne le signale.
    """
    tous = tous_domaines(url_ou_domaine)
    return tous[0] if tous else ""


def tous_domaines(champ):
    """Tous les domaines valides d'un champ, dans l'ordre de saisie.

    « axa.com / axa.fr » en déclare DEUX, et les deux appartiennent au compte.
    N'indexer que le premier laissait axa.fr non résolu — un signal aurait été
    perdu sans qu'aucune erreur ne le signale.
    """
    if not champ:
        return []
    brut = re.sub(r"^https?://", "", str(champ).strip().lower())
    trouves = []
    for morceau in re.split(r"[/,;\s]", brut):
        d = re.sub(r"\([^)]*\)", " ", morceau).strip().split("?")[0]
        if d.startswith("www."):
            d = d[4:]
        if re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", d) and d not in trouves:
            trouves.append(d)
    return trouves


class Annuaire:
    """Index des comptes suivis, construit une fois par passage.

    Avec quelques dizaines à quelques centaines de comptes, tout tient en
    mémoire : inutile d'aller chercher pg_trgm côté base pour chaque document.
    """

    def __init__(self, comptes):
        self.comptes = comptes
        self.par_domaine = {}
        self.par_nom = {}
        self.par_id = {str(c.get("id")): c for c in comptes}
        for c in comptes:
            for d in tous_domaines(c.get("domain")):
                self.par_domaine.setdefault(d, c)
            k = cle_nom(c.get("name"))
            if k:
                self.par_nom[k] = c
        self._cles = list(self.par_nom)

    def chercher_dans_texte(self, texte_brut):
        """Cherche un compte suivi CITÉ dans un texte de presse.

        Stratégie inverse de `resoudre` : on ne connaît pas l'entreprise à
        l'avance, on balaie le texte à la recherche des comptes du portefeuille.

        Le piège est le faux positif sur les raisons sociales d'un seul mot :
        « Orange » désigne aussi un fruit, « Carrefour » un croisement. Pour ces
        noms, on exige la forme EXACTEMENT CAPITALISÉE dans le texte d'origine —
        une majuscule en milieu de phrase distingue de façon fiable la marque du
        mot commun, pour un coût nul.
        """
        if not texte_brut:
            return None, None, 0.0
        texte_norm = normaliser(texte_brut)
        trouve, longueur_max, confiance = None, 0, 0.0

        for compte in self.comptes:
            nom = (compte.get("name") or "").strip()
            recherche = forme_recherche(nom)      # article conservé
            cle = cle_nom(nom)                    # article retiré
            if len(recherche) < 4:
                continue

            score = None
            if " " in recherche:
                # Raison sociale composée : suffisamment spécifique.
                # « la poste » ne matche pas « poste de travail ».
                if re.search(rf"\b{re.escape(recherche)}\b", texte_norm):
                    score = 0.90
            elif len(cle) >= 4:
                # Nom d'un seul mot signifiant (« Atos », « Orange ») : exiger
                # la CAPITALISATION dans le texte d'origine. Une majuscule en
                # milieu de phrase distingue la marque du nom commun, pour un
                # coût nul.
                if re.search(rf"\b{re.escape(cle.capitalize())}\b", texte_brut):
                    score = 0.78

            if score is None:
                continue

            # Le nom le plus long l'emporte : « Crédit Agricole Assurances »
            # doit primer sur « Crédit Agricole » si les deux sont suivis.
            if len(recherche) > longueur_max:
                trouve, longueur_max, confiance = compte, len(recherche), score

        return trouve, ("mention" if trouve else None), confiance

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
