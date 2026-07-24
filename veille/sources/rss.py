"""Connecteur presse — flux RSS et Atom.

Complément indispensable à TED : la commande publique ne parle jamais des
grands comptes privés du portefeuille. C'est la presse qui allume les comptes
déjà suivis (nominations, projets, incidents, opérations financières).

Deux partis pris de conformité, pas des raccourcis techniques :

  1. On ne collecte QUE les métadonnées du flux — titre, résumé publié par
     l'éditeur, lien, date. Le texte intégral des articles est protégé par le
     droit d'auteur ; on ne le télécharge pas et on ne le stocke pas. Le lien
     renvoie toujours vers l'éditeur.

  2. On respecte les refus. Un flux qui répond 403 (Usine Digitale au moment
     de l'écriture) n'est pas contourné : il est retiré de la liste.

Le résumé d'un flux suffit largement au filtre lexical. Aller chercher le corps
de chaque article coûterait des minutes de CI, poserait un problème de droits,
et n'améliorerait la détection qu'à la marge.
"""

import html
import re
import urllib.request
from datetime import datetime, timedelta, timezone

from .base import Document

# Certains éditeurs refusent un client sans User-Agent identifiable. On
# s'annonce honnêtement plutôt que d'imiter un navigateur.
UA = "FoxProspect/1.0 (veille commerciale; +https://github.com/PierreNTE/fox-prospect)"

BALISES_HTML = re.compile(r"<[^>]+>")
ESPACES = re.compile(r"\s+")

# Mentions ajoutées automatiquement par les CMS en fin de résumé. Elles
# n'apportent rien et occupent la place utile sur une fiche compte — le résumé
# est lu avant un rendez-vous, pas parcouru dans un agrégateur.
OURS = re.compile(
    r"\s*(the post .+? appeared first on .+?|l[’']article .+? est apparu en premier sur .+?|"
    r"cet article .+? est apparu en premier sur .+?|"
    r"(continue|weiterlesen|lire la suite|read more)\b.*)$",
    re.I | re.S,
)


def _texte(brut):
    """Résumé d'un flux, débarrassé du balisage et des entités.

    Le décodage des entités n'est pas cosmétique : sans lui, « sans qu&#8217;on »
    reste collé et le filtre lexical raisonne sur des mots qui n'existent pas.
    C'est aussi ce qui s'affichera sur la fiche client.
    """
    if not brut:
        return ""
    sans_balises = BALISES_HTML.sub(" ", str(brut))
    return ESPACES.sub(" ", html.unescape(sans_balises)).strip()


# Mots outils très fréquents, choisis pour ne pas se recouvrir d'une langue à
# l'autre. Suffisant pour trancher entre trois langues sur un titre + résumé —
# et sans dépendance, là où langdetect coûterait un paquet pour ce seul usage.
INDICES_LANGUE = {
    "fr": (" le ", " la ", " les ", " des ", " du ", " une ", " et ", " pour ",
           " avec ", " sur ", " dans ", " est "),
    "en": (" the ", " of ", " and ", " to ", " for ", " with ", " is ", " on ",
           " its ", " has "),
    "de": (" der ", " die ", " das ", " und ", " für ", " mit ", " von ",
           " ist ", " den ", " im "),
}


def deviner_langue(texte):
    """Langue dominante d'un texte court, ou None si indécidable."""
    t = f" {(texte or '').lower()} "
    scores = {lg: sum(t.count(m) for m in mots) for lg, mots in INDICES_LANGUE.items()}
    meilleur = max(scores, key=scores.get)
    return meilleur if scores[meilleur] >= 2 else None


def _date_entree(entree):
    """Date de publication normalisée en AAAA-MM-JJ, ou None."""
    for champ in ("published_parsed", "updated_parsed"):
        t = entree.get(champ)
        if t:
            try:
                return datetime(*t[:6], tzinfo=timezone.utc).date().isoformat()
            except (TypeError, ValueError):
                continue
    return None


def collecter(source, depuis_jours=2, plafond=200, **_):
    """Collecte les entrées récentes d'un flux. Renvoie (documents, curseur)."""
    import feedparser        # importé ici : inutile quand seul TED tourne

    url = source.get("url")
    if not url:
        raise RuntimeError("source RSS sans url")

    requete = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
    })
    with urllib.request.urlopen(requete, timeout=20) as reponse:
        brut = reponse.read()

    flux = feedparser.parse(brut)
    # `bozo` signale un flux malformé. feedparser sait souvent le lire quand
    # même : on n'échoue que si rien n'a pu être extrait.
    if flux.bozo and not flux.entries:
        raise RuntimeError(f"flux illisible : {getattr(flux, 'bozo_exception', 'inconnu')}")

    limite = (datetime.now(timezone.utc).date() - timedelta(days=depuis_jours)).isoformat()
    config = source.get("config") or {}
    # `lang` déclaré = tri actif du flux. Le code pays sert seulement d'étiquette
    # par défaut : il ne dit pas dans quelle langue un groupe communique.
    langue_voulue = config.get("lang")
    langue = langue_voulue or source.get("country_code", "").lower()[:2] or None

    # Un flux de salle de presse ne parle que de son entreprise : la SOURCE
    # désigne le compte, il n'y a plus rien à chercher dans le texte. C'est le
    # seul rattachement de presse qui ne puisse pas produire de faux positif.
    compte = source.get("account_id")
    strategie = "source" if compte else "mention"

    documents, plus_recente = [], None
    for entree in flux.entries[:plafond]:
        lien = entree.get("link")
        titre = _texte(entree.get("title"))
        if not lien or not titre:
            continue

        publie = _date_entree(entree)
        # Un flux sans date est conservé : mieux vaut un doublon écarté par
        # l'unicité d'URL qu'une actualité manquée.
        if publie and publie < limite:
            continue

        resume = OURS.sub("", _texte(entree.get("summary") or entree.get("description")))[:1000]

        # Beaucoup de salles de presse diffusent le MÊME communiqué en
        # plusieurs langues dans un flux unique, sous des URL distinctes :
        # l'unicité d'url_hash ne les voit pas. Sans ce tri, chaque annonce
        # apparaît deux fois sur la fiche client.
        detectee = deviner_langue(f"{titre} {resume}")
        if langue_voulue and detectee and detectee != langue_voulue:
            continue
        if publie and (plus_recente is None or publie > plus_recente):
            plus_recente = publie

        documents.append(Document(
            url=lien,
            title=titre,
            excerpt=resume,
            lang=detectee or langue,
            published_at=publie,
            source_id=source.get("id"),
            raw={
                "flux": source.get("label"),
                "auteur": _texte(entree.get("author"))[:120] or None,
                # « source »  : le compte est désigné par la source elle-même ;
                # « mention » : il faut le chercher dans le texte (presse
                #               généraliste), méthode faillible par nature.
                "strategie_rattachement": strategie,
                "account_id": compte,
            },
        ))

    return documents, plus_recente
