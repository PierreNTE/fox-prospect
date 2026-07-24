"""Connecteur TED — Tenders Electronic Daily.

Premier connecteur livré : meilleur rapport valeur/effort du périmètre. Du JSON
structuré sous licence ouverte, aucun scraping, aucun NLP lourd, et un accès
anonyme sans clé d'API.

Deux usages distincts, portés par le champ `notice-type` :
  · `cn-*`  (contract notice)       → appel d'offres en cours = signal rfp_it ;
  · `can-*` (contract award notice) → marché ATTRIBUÉ, avec le nom du titulaire
    = veille concurrentielle (HPE, Lenovo, HP Inc.) et, quand la date de fin de
    contrat est publiée, une fenêtre de reconquête connue à l'avance.

Contrat vérifié le 24/07/2026 contre l'API de production :
  POST https://api.ted.europa.eu/v3/notices/search
  Réponse : {notices, totalNoticeCount, iterationNextToken, timedOut}
Les champs demandés sont valides mais PAS TOUJOURS PEUPLÉS (notice-title et
winner-name manquent sur de nombreux avis) : tout accès passe donc par des
extracteurs tolérants.
"""

import json
import urllib.request
from datetime import date, timedelta

from .base import Document, texte_propre

API = "https://api.ted.europa.eu/v3/notices/search"

# Champs demandés. `links` est renvoyé même sans être demandé.
CHAMPS = [
    "publication-number", "publication-date", "notice-type",
    "notice-title", "title-proc", "contract-title",     # candidats titre, par ordre de préférence
    "buyer-name", "place-of-performance", "classification-cpv",
    "winner-name", "winner-country",
    "contract-conclusion-date", "contract-duration-end-date-lot",
    "estimated-value-proc", "estimated-value-cur-proc",
]

CHAMPS_TITRE = ("notice-title", "title-proc", "contract-title")


def _texte_multilingue(valeur, langues_pref=("fra", "eng", "deu")):
    """TED renvoie certains champs en dictionnaire {code_langue: [valeurs]}.

    On privilégie le français, puis l'anglais, puis l'allemand, et à défaut la
    première langue disponible — plutôt que de renvoyer vide.
    """
    if valeur is None:
        return ""
    if isinstance(valeur, str):
        return valeur.strip()
    if isinstance(valeur, list):
        return _texte_multilingue(valeur[0]) if valeur else ""
    if isinstance(valeur, dict):
        for lg in langues_pref:
            if valeur.get(lg):
                return _texte_multilingue(valeur[lg])
        for v in valeur.values():
            t = _texte_multilingue(v)
            if t:
                return t
    return ""


def _premiere_date(valeur):
    """« 2026-06-22+02:00 » ou une liste → « 2026-06-22 »."""
    if isinstance(valeur, list):
        valeur = valeur[0] if valeur else None
    if not isinstance(valeur, str):
        return None
    return valeur[:10] or None


def _langue_depuis(valeur):
    """Déduit la langue du dictionnaire multilingue renvoyé par TED.

    Évite d'appeler un détecteur de langue : l'information est déjà là.
    """
    if isinstance(valeur, dict):
        for code in valeur:
            return {"fra": "fr", "deu": "de", "eng": "en", "nld": "nl",
                    "ita": "it", "spa": "es"}.get(code, code[:2])
    return None


def _requete(query, limite, page):
    corps = json.dumps({
        "query": query,
        "fields": CHAMPS,
        "limit": min(limite, 250),      # 250 = maximum par page côté TED
        "page": page,
        "scope": "ALL",
        "paginationMode": "PAGE_NUMBER",
    }).encode()
    req = urllib.request.Request(
        API, data=corps, method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode())


def normaliser_types(types):
    """Complète les types d'avis abrégés.

    L'API rejette « cn » : elle attend « cn-standard ». On tolère la forme
    courte plutôt que d'imposer une correction en base — la configuration des
    sources est modifiable par l'utilisateur, elle doit pardonner.
    """
    sortie = []
    for t in types or []:
        t = str(t).strip()
        sortie.append(t if "-" in t else f"{t}-standard")
    return sortie


def construire_query(config, depuis_jours, pays):
    """Construit la requête « expert search » de TED.

    Les codes CPV doivent être COMPLETS (8 chiffres) : l'API rejette un préfixe
    comme « 72 », vérifié à l'usage contre l'API de production.
    """
    if config.get("cpv_prefixes") and not config.get("cpv_codes"):
        print("    (cpv_prefixes ignoré : TED exige des codes complets — "
              "codes par défaut utilisés)")
    cpv = config.get("cpv_codes") or [
        "30200000",   # matériel informatique
        "30213000",   # ordinateurs personnels et portables
        "30233000",   # supports de stockage
        "48000000",   # logiciels
        "48800000",   # systèmes d'information
        "48820000",   # serveurs
        "72000000",   # services informatiques
        "72500000",   # services d'infogérance
    ]
    morceaux = [
        f"classification-cpv IN ({' '.join(cpv)})",
        f"publication-date>=today(-{depuis_jours})",
    ]
    types = normaliser_types(config.get("notice_types"))
    if types:
        morceaux.append("(" + " OR ".join(f"notice-type={t}" for t in types) + ")")
    if pays:
        morceaux.append(f"place-of-performance IN ({' '.join(pays)})")
    return " AND ".join(morceaux)


def collecter(source, depuis_jours=2, pays=None, plafond=400, **_):
    """Collecte les avis TED récents. Renvoie (documents, nouveau_cursor).

    UNE REQUÊTE PAR PAYS, chacune avec sa part du plafond. Une requête unique
    couvrant FRA+DEU+GBR paraît plus économique, mais l'API renvoie les avis par
    date de publication : le pays qui publie le plus remplit le quota et les
    autres n'apparaissent jamais. Mesuré au passage du 24 juillet — sur 594
    acheteurs publics identifiés, la quasi-totalité étaient allemands, non parce
    que le marché allemand est plus actif pour ce commercial, mais parce que
    l'Allemagne publie davantage d'avis.
    """
    config = source.get("config") or {}
    liste_pays = list(pays) if pays else [None]
    part = max(1, plafond // len(liste_pays))

    documents = []
    for p in liste_pays:
        lot = _collecter_query(construire_query(config, depuis_jours, [p] if p else None),
                               source["id"], part)
        if p:
            print(f"    {p} : {len(lot)}")
        documents.extend(lot)

    # Le reliquat d'un pays peu actif n'est PAS redistribué aux autres : ce
    # serait rendre au pays dominant la place qu'on vient de lui retirer.
    dates = [d.published_at for d in documents if d.published_at]
    return documents, (max(dates) if dates else None)


def _collecter_query(query, source_id, plafond):
    documents, page, vus = [], 1, 0
    while len(documents) < plafond:
        demande = min(250, plafond - len(documents))   # 250 = maximum côté TED
        data = _requete(query, limite=demande, page=page)
        if data.get("message"):                       # erreur de syntaxe de requête
            raise RuntimeError(f"TED: {data['message'][:200]}")
        avis = data.get("notices") or []
        if not avis:
            break

        vus += len(avis)
        for a in avis:
            doc = _vers_document(a, source_id)
            if doc:
                documents.append(doc)

        # Page incomplète, ou total atteint : il n'y a plus rien à demander.
        # La comparaison porte sur ce qui a été DEMANDÉ, pas sur une taille de
        # page supposée : depuis le quota par pays, la demande vaut rarement 250.
        if len(avis) < demande or vus >= (data.get("totalNoticeCount") or 0):
            break
        page += 1

    return documents


def _vers_document(avis, source_id):
    numero = avis.get("publication-number")
    if not numero:
        return None

    titre = ""
    for champ in CHAMPS_TITRE:
        titre = _texte_multilingue(avis.get(champ))
        if titre:
            break

    # Décodés au même titre que le titre : le nom de l'acheteur est AFFICHÉ
    # (carte des candidats, extrait du signal), il subit donc le même nettoyage.
    # `en_ligne()` ne touche que title et excerpt, pas le contenu de `raw`.
    acheteur = texte_propre(_texte_multilingue(avis.get("buyer-name")))
    type_avis = avis.get("notice-type") or ""
    gagnant = texte_propre(_texte_multilingue(avis.get("winner-name")))

    # Titre de repli : de nombreux avis n'ont aucun champ titre peuplé. Mieux
    # vaut une ligne construite à partir de l'acheteur qu'un document sans nom.
    if not titre:
        titre = f"Marché public — {acheteur}" if acheteur else f"Avis TED {numero}"

    resume = []
    if acheteur:
        resume.append(f"Acheteur : {acheteur}")
    if gagnant:
        resume.append(f"Titulaire : {gagnant}")
    fin = _premiere_date(avis.get("contract-duration-end-date-lot"))
    if fin:
        resume.append(f"Fin de marché : {fin}")

    return Document(
        url=f"https://ted.europa.eu/fr/notice/{numero}",
        title=titre,
        excerpt=" · ".join(resume),
        lang=_langue_depuis(avis.get("buyer-name")),
        published_at=_premiere_date(avis.get("publication-date")),
        source_id=source_id,
        raw={
            "publication_number": numero,
            "notice_type": type_avis,
            # `can` = contract award notice : c'est le marqueur de la veille
            # concurrentielle, calculé ici pour ne pas le redéduire plus tard.
            "est_attribution": type_avis.startswith("can"),
            "cpv": sorted(set(avis.get("classification-cpv") or [])),
            "buyer_name": acheteur,
            "winner_name": gagnant,
            "winner_country": avis.get("winner-country"),
            "place_of_performance": sorted(set(avis.get("place-of-performance") or [])),
            # Le rattachement passe par l'ACHETEUR, jamais par le titulaire :
            # quand un intégrateur gagne chez un hôpital, le compte concerné
            # est l'hôpital.
            "strategie_rattachement": "acheteur",
            "conclusion_date": _premiere_date(avis.get("contract-conclusion-date")),
            "contract_end_date": fin,
            "estimated_value": avis.get("estimated-value-proc"),
            "currency": avis.get("estimated-value-cur-proc"),
        },
    )
