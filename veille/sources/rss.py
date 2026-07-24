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

import re
import urllib.request
from datetime import datetime, timedelta, timezone

from .base import Document

# Certains éditeurs refusent un client sans User-Agent identifiable. On
# s'annonce honnêtement plutôt que d'imiter un navigateur.
UA = "FoxProspect/1.0 (veille commerciale; +https://github.com/PierreNTE/fox-prospect)"

BALISES_HTML = re.compile(r"<[^>]+>")
ESPACES = re.compile(r"\s+")


def _texte(html):
    """Résumé d'un flux, débarrassé du balisage."""
    if not html:
        return ""
    return ESPACES.sub(" ", BALISES_HTML.sub(" ", str(html))).strip()


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
    langue = config.get("lang") or source.get("country_code", "").lower()[:2] or None

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
        if publie and (plus_recente is None or publie > plus_recente):
            plus_recente = publie

        documents.append(Document(
            url=lien,
            title=titre,
            excerpt=_texte(entree.get("summary") or entree.get("description"))[:1000],
            lang=langue,
            published_at=publie,
            source_id=source.get("id"),
            raw={
                "flux": source.get("label"),
                "auteur": _texte(entree.get("author"))[:120] or None,
                # Indique au pipeline de chercher des noms de comptes DANS le
                # texte, au lieu de résoudre un acheteur identifié (cas TED).
                "strategie_rattachement": "mention",
            },
        ))

    return documents, plus_recente
