"""Étage 4 — vectorisation multilingue (BGE-M3).

Séparé du passage principal, et volontairement : torch et sentence-transformers
pèsent plus de 2 Go et plusieurs minutes d'installation. Les faire installer par
la collecte reviendrait à payer ce prix même les jours où il n'y a rien à
vectoriser, et surtout à faire échouer la COLLECTE quand une roue Python casse.
D'où le contrat de ce module : il s'annonce indisponible plutôt que de lever.

Ce que la vectorisation apporte, et qu'aucun mot-clé ne remplace : un thème
écrit en français rapproche un avis rédigé en allemand. C'est la raison d'être
du choix d'un modèle multilingue plutôt que d'une recherche plein texte, qui
existe déjà en base (index GIN de v12) et reste le bon outil pour un nom propre.
"""

import time

import db
from config import MAX_EMBED_PAR_PASSAGE, MODELE_EMBED, PURGE_MOIS

_modele = None


def charger_modele():
    """Charge le modèle, ou renvoie None si les briques NLP ne sont pas là.

    None n'est pas une erreur : le passage quotidien tourne sans, la recherche
    sémantique reste simplement vide. Toute autre panne (modèle absent du cache,
    mémoire insuffisante) remonte, elle, parce qu'elle est réparable.
    """
    global _modele
    if _modele is not None:
        return _modele
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        return None
    debut = time.time()
    _modele = SentenceTransformer(MODELE_EMBED, device="cpu")
    print(f"  modèle {MODELE_EMBED} chargé en {time.time() - debut:.1f} s")
    return _modele


def vectoriser(textes, lot=16):
    """Textes → vecteurs au format littéral pgvector.

    On sérialise en chaîne « [0.1,0.2,…] » : c'est la forme d'entrée native de
    pgvector, la seule que PostgREST sache transmettre sans extension côté
    client. Six décimales suffisent — halfvec stocke en fp16, garder plus de
    précision ne ferait que gonfler la requête.
    """
    modele = charger_modele()
    if modele is None:
        return None
    vecteurs = modele.encode(textes, batch_size=lot, show_progress_bar=False,
                             normalize_embeddings=True)
    return ["[" + ",".join(f"{x:.6f}" for x in v) + "]" for v in vecteurs]


def vectoriser_themes(dry_run=False):
    """Vectorise les thèmes de recherche qui n'ont pas encore de vecteur.

    Quelques lignes au plus, mais l'ordre compte : un thème sans vecteur
    n'apparaît pas dans l'interface. On le fait donc AVANT les signaux, dont le
    volume peut consommer tout le temps disponible.
    """
    themes = db.themes_a_vectoriser()
    if not themes:
        return 0

    vecteurs = vectoriser([t["query"] for t in themes])
    if vecteurs is None:
        return 0
    if dry_run:
        return len(themes)

    for theme, vecteur in zip(themes, vecteurs):
        db.maj_theme_vecteur(theme["id"], vecteur)
        print(f"  thème vectorisé : {theme['label']}")
    return len(themes)


def purger(dry_run=False, mois=None):
    """Purge glissante des vecteurs trop anciens.

    Rattachée à l'étage de vectorisation plutôt qu'à un cron séparé : c'est le
    seul endroit qui écrit des vecteurs, donc le seul qui ait une raison d'en
    retirer. Et comme cette étape tolère l'échec, une purge qui échoue ne fait
    pas tomber le passage.

    Sans appelant, la fonction SQL de la migration v12 restait lettre morte sur
    un projet où pg_cron n'est pas activé.
    """
    if dry_run:
        return 0
    try:
        return db.purger_embeddings(mois or PURGE_MOIS) or 0
    except Exception as e:
        print(f"  purge des vecteurs impossible : {e}")
        return 0


def vectoriser_signaux(dry_run=False, limite=None):
    """Vectorise les signaux qui n'ont pas encore de vecteur, les récents d'abord.

    Le plafond est un plafond de TEMPS déguisé : le passage quotidien dispose
    d'une trentaine de minutes de runner, et l'embarquement est la seule étape
    dont la durée croît avec le volume collecté. Les signaux non traités
    aujourd'hui le seront demain — l'anti-jointure les retrouve.
    """
    limite = limite or MAX_EMBED_PAR_PASSAGE
    signaux = db.signaux_sans_embedding(limite)
    if not signaux:
        return 0

    textes = [s["texte"] or "" for s in signaux]
    debut = time.time()
    vecteurs = vectoriser(textes)
    if vecteurs is None:
        print("  briques NLP absentes (pip install -r veille/requirements-nlp.txt)")
        return 0

    duree = time.time() - debut
    print(f"  {len(signaux)} signaux vectorisés en {duree:.1f} s "
          f"({len(signaux) / duree:.1f}/s)")
    if dry_run:
        return len(signaux)

    db.enregistrer_embeddings([
        {"signal_id": s["id"], "embedding": v, "model": MODELE_EMBED.split("/")[-1]}
        for s, v in zip(signaux, vecteurs)
    ])
    return len(signaux)
