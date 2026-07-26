"""Découverte des flux de salle de presse, compte par compte.

Pourquoi cet outil existe
─────────────────────────
Mesuré sur données réelles : 328 articles de presse IT généraliste sur 7 jours
ne citent que 3 des comptes suivis, pour 1 seul signal. La presse généraliste
parle de technologies, pas des grands comptes nommément.

La salle de presse de l'entreprise elle-même, en revanche, ne parle QUE d'elle.
Le rattachement y devient certain — c'est la source qui désigne le compte, plus
aucune recherche de nom dans un texte, donc plus aucun faux positif possible.

Pourquoi ce n'est pas codé en dur
─────────────────────────────────
Deviner « domaine + /rss » donne surtout des 404. Le web publie déjà cette
information : la balise <link rel="alternate" type="application/rss+xml">, que
les navigateurs et agrégateurs utilisent depuis vingt ans. On la lit au lieu de
la deviner, et on ne retient un flux qu'après l'avoir VALIDÉ (il répond, il
contient des entrées datées).

Usage :
    python veille/decouvrir_flux.py                    # comptes lus en base
    python veille/decouvrir_flux.py --comptes x.json   # hors ligne
    python veille/decouvrir_flux.py --sql out.sql      # génère le SQL d'insertion

Le script N'ÉCRIT RIEN en base : il produit du SQL à relire avant application.
Une source de veille mal ciblée pollue durablement les fiches ; le passage par
une relecture humaine est délibéré.
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

UA = ("FoxProspect/1.0 (veille commerciale; "
      "+https://github.com/PierreNTE/fox-prospect)")

# Pages où une salle de presse se trouve habituellement. La racine d'abord :
# beaucoup de groupes déclarent leur flux dans le <head> global.
CHEMINS_SONDES = [
    "", "/fr", "/en",
    "/newsroom", "/news", "/press", "/media",
    "/actualites", "/presse", "/fr/actualites", "/fr/presse",
    "/en/news", "/en/newsroom", "/en/media",
]

# Repli quand aucune balise n'est déclarée. Volontairement court : sonder
# quinze chemins par domaine coûte des centaines de requêtes pour un gain
# marginal, et un 404 en masse ressemble à du balayage.
CHEMINS_FLUX = ["/rss", "/feed", "/rss.xml", "/feed.xml", "/atom.xml"]

BALISE_FLUX = re.compile(
    r"""<link\b[^>]*?rel=["']?alternate["']?[^>]*>""",
    re.I | re.S,
)
ATTR_TYPE = re.compile(r"""type=["']([^"']+)["']""", re.I)
ATTR_HREF = re.compile(r"""href=["']([^"']+)["']""", re.I)
ATTR_TITRE = re.compile(r"""title=["']([^"']*)["']""", re.I)

# Beaucoup de grands groupes ne déclarent plus de balise <link rel="alternate">
# — leur CMS ne la génère pas — mais gardent un lien « RSS » en pied de page.
# Mesuré sur les 30 comptes du portefeuille : sans cette récolte, la découverte
# passe à côté de la majorité des flux réellement publiés.
LIEN_FLUX = re.compile(
    r"""<a\b[^>]*?href=["']([^"']*(?:rss|atom|/feed)[^"']*)["']""", re.I)

# Pièges classiques : « rss » apparaît dans des chemins d'images, de scripts,
# ou dans des URL de partage vers un agrégateur tiers.
LIEN_EXCLU = re.compile(
    r"""\.(png|jpe?g|svg|gif|css|js)(\?|$)|feedly|feedburner\.google|"""
    r"""addtoany|netvibes|inoreader""", re.I)

TYPES_FLUX = ("application/rss+xml", "application/atom+xml", "application/xml")


def nettoyer_domaine(brut):
    """« renaultgroup.com (corporate) / renault.fr (marque) » → « renaultgroup.com ».

    Le champ `domain` est saisi à la main : il contient des variantes séparées
    par « / » et des annotations entre parenthèses. On retient la première
    valeur qui ressemble à un domaine. Sans ce nettoyage, le rattachement par
    domaine échoue en silence sur ces comptes — un bug déjà présent dans la
    cascade de résolution.
    """
    if not brut:
        return None
    for morceau in re.split(r"[/,;]", str(brut)):
        morceau = re.sub(r"\([^)]*\)", " ", morceau).strip().lower()
        morceau = re.sub(r"^https?://", "", morceau).split("/")[0]
        if morceau.startswith("www."):
            morceau = morceau[4:]
        if re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", morceau):
            return morceau
    return None


def _get(url, timeout=12, taille_max=400_000):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr,en;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(taille_max), r.headers.get("Content-Type", ""), r.geturl()


def flux_declares(html, base):
    """Extrait les flux annoncés par <link rel="alternate">."""
    trouves = []
    for balise in BALISE_FLUX.findall(html):
        t = ATTR_TYPE.search(balise)
        h = ATTR_HREF.search(balise)
        if not h or not t or t.group(1).lower().split(";")[0] not in TYPES_FLUX:
            continue
        titre = ATTR_TITRE.search(balise)
        trouves.append((
            urllib.parse.urljoin(base, h.group(1)),
            (titre.group(1) if titre else "").strip(),
        ))
    return trouves


def flux_lies(html, base):
    """Extrait les flux atteignables par un lien « RSS » de la page."""
    trouves = []
    for href in LIEN_FLUX.findall(html):
        if LIEN_EXCLU.search(href):
            continue
        lien = urllib.parse.urljoin(base, href)
        if lien.lower().startswith(("http://", "https://")):
            trouves.append((lien, ""))
    return trouves


def valider(url):
    """Un flux n'est retenu que s'il répond ET contient des entrées.

    Une URL qui renvoie 200 avec une page d'erreur HTML est le mode d'échec le
    plus courant ; seul le parsing effectif le détecte.
    """
    import feedparser
    try:
        brut, ctype, final = _get(url, timeout=15)
    except Exception as e:
        return None, f"injoignable ({type(e).__name__})", None
    if "html" in ctype.lower() and b"<rss" not in brut[:2000] and b"<feed" not in brut[:2000]:
        # Cas très fréquent : « /flux-rss » est une PAGE listant les flux, pas
        # un flux. Le HTML est renvoyé pour que l'appelant puisse y récolter
        # les vrais liens, au lieu de conclure à un échec.
        return None, "HTML, pas un flux", (brut.decode("utf-8", "replace"), final)
    flux = feedparser.parse(brut)
    entrees = getattr(flux, "entries", [])
    if not entrees:
        return None, "flux vide", None
    datees = sum(1 for e in entrees
                 if e.get("published_parsed") or e.get("updated_parsed"))
    return {
        "url": url,
        "titre": (getattr(flux.feed, "title", "") or "").strip()[:120],
        "entrees": len(entrees),
        "datees": datees,
    }, None, None


def explorer(compte):
    """Cherche les flux d'un compte. Renvoie (compte, [flux validés], journal)."""
    domaine = nettoyer_domaine(compte.get("domain"))
    journal = []
    if not domaine:
        return compte, [], ["domaine inexploitable"]

    # Trois niveaux de preuve, du plus fiable au moins fiable. On s'arrête au
    # premier qui donne quelque chose, plutôt que de sonder inutilement.
    declares, lies, vus = [], [], set()
    for chemin in CHEMINS_SONDES:
        url = f"https://www.{domaine}{chemin}" if chemin == "" else f"https://{domaine}{chemin}"
        try:
            brut, ctype, final = _get(url)
        except Exception:
            continue
        if "html" not in ctype.lower():
            continue
        html = brut.decode("utf-8", "replace")
        for source, lien, titre in (
            [("d", l, t) for l, t in flux_declares(html, final)]
            + [("l", l, t) for l, t in flux_lies(html, final)]
        ):
            if lien in vus:
                continue
            vus.add(lien)
            (declares if source == "d" else lies).append((lien, titre))
        if declares:
            break                      # une balise déclarée suffit

    # Les trois niveaux se CUMULENT, dans l'ordre de fiabilité. Les traiter
    # comme exclusifs faisait disparaître les flux d'Atos : des liens de page
    # sans intérêt épuisaient le budget de candidats avant que « /rss », qui
    # lui répondait, ne soit essayé.
    candidats = list(declares) + list(lies) + [
        (f"https://{domaine}{c}", "") for c in CHEMINS_FLUX
        if f"https://{domaine}{c}" not in vus
    ]
    if not declares:
        journal.append("aucune balise déclarée dans le <head>")

    valides, essais, rebonds = [], 0, 0
    file = list(candidats)
    while file and essais < 20:
        lien, titre = file.pop(0)
        essais += 1
        ok, motif, page = valider(lien)
        if ok:
            ok["titre"] = ok["titre"] or titre
            valides.append(ok)
            if len(valides) >= 4:          # assez pour choisir le meilleur
                break
            continue
        journal.append(f"{lien} → {motif}")
        # Un seul rebond : « /flux-rss » renvoie une page qui liste les flux.
        # Sans ce saut, Crédit Agricole et Stellantis restent sans source alors
        # qu'ils en publient. Bornée à un niveau — au-delà, on crawlerait.
        #
        # Les liens rebondis sont mis en FIN de file : les placer devant faisait
        # disparaître le flux d'Atos, dont « /rss » — un chemin de repli, donc
        # en queue — n'était plus jamais atteint.
        if page and rebonds < 1:
            rebonds += 1
            for l, t in flux_lies(page[0], page[1]):
                if l not in vus:
                    vus.add(l)
                    file.append((l, t))
    return compte, valides, journal


# Codes de langue apparaissant dans les chemins d'URL des sites multilingues.
AUTRES_LANGUES = ("/it", "/de", "/es", "/pt", "/nl", "/pl", "/zh", "/ja", "/ru", "/tr")

# Un même groupe publie souvent plusieurs flux sous des URL voisines. Crédit
# Agricole expose « A la une » (communiqués) et « Tendances Eco » (recherche
# macro-économique) sous /rss_flux/183812 et /rss_flux/183813 : rien dans l'URL
# ne les distingue, et le second n'a aucune valeur commerciale.
MOTS_PERTINENTS = ("communiqu", "press", "presse", "actualit", "newsroom",
                   "news", "a la une", "media")
MOTS_HORS_SUJET = ("tendance", "econom", "économ", "research", "recherche",
                   "emploi", "career", "carrier", "job", "agenda", "event",
                   "blog", "podcast", "publication", "investor", "bourse")


def preference(flux):
    """Ordre de choix entre plusieurs flux valides d'un même compte.

    La langue prime sur le volume : Stellantis publie ses communiqués en six
    langues, et le premier flux rencontré était l'italien. Un signal en italien
    dans un CRM francophone est lisible mais inutilement coûteux — Claude devra
    le traiter, le commercial devra le déchiffrer.
    """
    u = flux["url"].lower()
    if "/fr" in u or ".fr/" in u:
        langue = 3
    elif any(c in u for c in AUTRES_LANGUES):
        langue = 0
    elif "/en" in u:
        langue = 2
    else:
        langue = 2                     # pas de code de langue : version par défaut

    # Le TITRE du flux est ce qui distingue les rubriques : on le lit, on ne
    # devine pas depuis l'URL.
    etiquette = f"{flux.get('titre', '')} {u}".lower()
    pertinence = 0
    if any(m in etiquette for m in MOTS_PERTINENTS):
        pertinence += 1
    if any(m in etiquette for m in MOTS_HORS_SUJET):
        pertinence -= 1

    return (langue, pertinence, flux["entrees"])


def charger_comptes(chemin):
    if chemin:
        return json.loads(Path(chemin).read_text(encoding="utf-8"))
    import db
    return db.comptes_suivis()


def echapper(valeur):
    return "'" + str(valeur).replace("'", "''") + "'"


def generer_sql(lignes):
    """SQL d'insertion, à relire puis appliquer manuellement."""
    entete = [
        "-- Flux de salle de presse découverts et validés automatiquement.",
        "-- Généré par veille/decouvrir_flux.py — À RELIRE avant application.",
        "",
        "insert into public.veille_sources (kind, label, url, account_id, config)",
        "select v.kind, v.label, v.url, v.account_id::uuid, v.config::jsonb",
        "from (values",
    ]
    corps = []
    for compte, flux in lignes:
        corps.append(
            "  ('rss', {label}, {url}, {aid}, '{{\"portee\":\"compte\"}}')".format(
                label=echapper(f"{compte['name']} — salle de presse"),
                url=echapper(flux["url"]),
                aid=echapper(compte["id"]),
            )
        )
    pied = [
        ") as v(kind, label, url, account_id, config)",
        "where not exists (",
        "  select 1 from public.veille_sources s where s.url = v.url",
        ");",
    ]
    return "\n".join(entete + [",\n".join(corps)] + pied) + "\n"


def main():
    ap = argparse.ArgumentParser(description="Découvre les flux de salle de presse.")
    ap.add_argument("--comptes", help="JSON de comptes (hors ligne)")
    ap.add_argument("--sql", help="fichier SQL à produire")
    ap.add_argument("--parallele", type=int, default=6)
    args = ap.parse_args()

    comptes = charger_comptes(args.comptes)
    print(f"{len(comptes)} comptes à sonder\n")

    retenus, sans_flux = [], []
    with ThreadPoolExecutor(max_workers=args.parallele) as pool:
        for compte, flux, journal in pool.map(explorer, comptes):
            if flux:
                meilleur = max(flux, key=preference)
                retenus.append((compte, meilleur))
                print(f"  ✓ {compte['name']:<28} {meilleur['entrees']:>3} entrées  "
                      f"{meilleur['url']}")
            else:
                sans_flux.append(compte["name"])
                print(f"  · {compte['name']:<28} aucun flux "
                      f"({journal[0] if journal else ''})")

    print(f"\n{len(retenus)} comptes équipés · {len(sans_flux)} sans flux")
    if sans_flux:
        print("  sans flux : " + ", ".join(sans_flux))

    if args.sql and retenus:
        Path(args.sql).write_text(generer_sql(retenus), encoding="utf-8")
        print(f"\nSQL écrit dans {args.sql} — à relire puis appliquer.")


if __name__ == "__main__":
    main()
