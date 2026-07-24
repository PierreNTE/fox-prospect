"""Contrat commun à toutes les sources de veille.

Toute source expose `collecter(source, sync_cursor) -> (documents, nouveau_cursor)`
et rien d'autre. Ajouter un pays ou un portail revient à écrire un fichier dans
ce dossier, sans toucher au pipeline.
"""

import hashlib
import urllib.parse
from dataclasses import dataclass, field, asdict

# Paramètres de suivi publicitaire : deux URLs qui n'en diffèrent que par ces
# clés désignent le même document et ne doivent pas produire deux entrées.
PARAMS_PARASITES = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source",
}


def normaliser_url(url):
    """Forme canonique d'une URL, pour que la déduplication soit fiable.

    Minuscules sur le schéma et l'hôte (la casse y est insignifiante), retrait
    du `www.`, du fragment et des paramètres de tracking, et suppression du
    slash final.
    """
    if not url:
        return ""
    p = urllib.parse.urlsplit(url.strip())
    hote = (p.hostname or "").lower()
    if hote.startswith("www."):
        hote = hote[4:]
    if p.port and not ((p.scheme == "https" and p.port == 443) or (p.scheme == "http" and p.port == 80)):
        hote = f"{hote}:{p.port}"

    params = [
        (k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
        if k.lower() not in PARAMS_PARASITES
    ]
    params.sort()

    chemin = p.path.rstrip("/") or "/"
    return urllib.parse.urlunsplit((
        (p.scheme or "https").lower(), hote, chemin,
        urllib.parse.urlencode(params), "",
    ))


def empreinte(url):
    """SHA-256 de l'URL normalisée — la clé d'unicité en base."""
    return hashlib.sha256(normaliser_url(url).encode()).hexdigest()


@dataclass
class Document:
    """Un document collecté, avant tout traitement.

    `excerpt` est un EXTRAIT COURT. Ne jamais y placer le texte intégral d'un
    article de presse : il est protégé par le droit d'auteur.
    """
    url: str
    title: str = ""
    excerpt: str = ""
    lang: str = None
    published_at: str = None          # AAAA-MM-JJ
    source_id: int = None
    raw: dict = field(default_factory=dict)

    def en_ligne(self):
        """Représentation prête pour l'insertion dans veille_documents."""
        d = asdict(self)
        d["url"] = normaliser_url(self.url)
        d["url_hash"] = empreinte(self.url)
        d["title"] = (self.title or "")[:500]
        d["excerpt"] = (self.excerpt or "")[:1000]
        d["status"] = "collecte"
        return d
