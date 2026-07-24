"""Point d'entrée du passage quotidien de veille.

Enchaîne les étages, chacun lisant un statut en base et écrivant le suivant.
Aucun état partagé entre étages : une exécution interrompue reprend là où elle
s'est arrêtée, ce qui remplace la reprise sur incident qu'un orchestrateur
offrirait.

Usage :
    python veille/run.py                # passage complet
    python veille/run.py --collecte     # collecte seule
    python veille/run.py --traitement   # traitement seul (rejeu sans recollecte)
    python veille/run.py --dry-run      # n'écrit rien, affiche ce qui serait fait
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
from config import (FENETRE_JOURS, MAX_DOCS_PAR_SOURCE, PAYS_MVP, RUN_REF,
                    exiger_supabase)
from pipeline import filtre
from pipeline.resolve import Annuaire
from sources import ted

# Type de signal déduit de la catégorie du filtre. La dimension produit est
# portée séparément par product_line : « projet » peut être CSG ou ISG.
TYPE_PAR_CATEGORIE = {
    "concurrence": "concurrence",
    "appel_offres": "rfp_it",
    "parc_client": "projet",
    "datacenter": "projet",
    "ia_gpu": "projet",
    "croissance": "recrutement",
    "nomination": "nomination",
    "cyber": "incident",
    "financement": "levee",
}


# Source de repli, utilisée uniquement en dry-run sans identifiants Supabase.
# Permet d'éprouver un connecteur en local sans toucher à la base — le cas
# d'usage le plus fréquent quand on met au point une requête TED.
SOURCE_LOCALE = {
    "id": None,
    "label": "TED (configuration locale de test)",
    "config": {"notice_types": ["cn-standard", "can-standard"]},
}


def _sources_ted():
    from config import SB_URL
    if not SB_URL:
        print("  (pas d'identifiants Supabase : source de test intégrée)")
        return [SOURCE_LOCALE]
    return db.charger_sources(kind="ted")


def collecter(dry_run=False):
    """Étage de collecte. Renvoie les lignes prêtes pour veille_documents."""
    collectes = []
    for source in _sources_ted():
        debut = time.time()
        try:
            documents, curseur = ted.collecter(
                source, depuis_jours=FENETRE_JOURS,
                pays=PAYS_MVP, plafond=MAX_DOCS_PAR_SOURCE,
            )
            lignes = [d.en_ligne() for d in documents]
            print(f"  {source['label']} : {len(lignes)} documents")
            if not dry_run:
                db.inserer_documents(lignes)
                db.maj_source(source["id"], sync_cursor=curseur)
                db.journaliser_run(
                    "collecte", source_id=source["id"], collected=len(lignes),
                    duration_ms=int((time.time() - debut) * 1000), run_ref=RUN_REF,
                )
            collectes.extend(lignes)
        except Exception as e:                       # une source morte ne doit pas
            print(f"  {source['label']} : ECHEC — {e}")   # arrêter les autres
            if not dry_run:
                db.maj_source(source["id"], erreur=str(e))
                db.journaliser_run("collecte", source_id=source["id"],
                                   erreur=str(e), run_ref=RUN_REF)
    return collectes


def traiter(dry_run=False, documents=None):
    """Étages filtre → rattachement → signal.

    `documents` permet d'enchaîner en mémoire en dry-run : sans écriture en
    base, l'étage suivant n'aurait rien à lire. C'est le mode utilisé pour
    régler le filtre lexical sans polluer la base.
    """
    debut = time.time()
    annuaire = Annuaire(db.comptes_suivis())
    print(f"  annuaire : {len(annuaire.comptes)} comptes suivis")

    if documents is None:
        documents = db.documents_a_traiter(["collecte", "extrait"], limite=1000)
    retenus = signaux = 0
    ecartes = {}

    for doc in documents:
        garde, motif, categories, ligne = filtre.evaluer(doc)
        if not garde:
            ecartes[motif] = ecartes.get(motif, 0) + 1
            if not dry_run:
                db.ecarter_document(doc["id"], motif)
            continue
        retenus += 1

        compte, methode, confiance = _rattacher(doc, annuaire)
        if not compte:
            # Hors périmètre : le document reste en base, mesurable, mais ne
            # pollue pas les fiches compte.
            ecartes["aucun compte suivi"] = ecartes.get("aucun compte suivi", 0) + 1
            if not dry_run:
                db.ecarter_document(doc["id"], "aucun compte suivi correspondant")
            continue

        signal = _construire_signal(doc, compte, categories, ligne, methode, confiance)
        print(f"  → {compte['name']} : {signal['type']}/{signal['product_line']} "
              f"({methode} {confiance}) — {signal['title'][:60]}")
        if not dry_run:
            db.creer_signal(signal)
            db.maj_document(doc["id"], status="rattache", processed_at="now()")
        signaux += 1

    # Le détail des rejets est ce qui rend le filtre réglable : sans lui, on ne
    # sait pas s'il est trop sévère ou trop laxiste.
    for motif, n in sorted(ecartes.items(), key=lambda kv: -kv[1]):
        print(f"  écarté · {motif} : {n}")

    if not dry_run:
        db.journaliser_run("traitement", collected=len(documents), kept=retenus,
                           signals=signaux, run_ref=RUN_REF,
                           duration_ms=int((time.time() - debut) * 1000))
    return len(documents), retenus, signaux


def _rattacher(doc, annuaire):
    raw = doc.get("raw") or {}
    return annuaire.resoudre(nom=raw.get("buyer_name"), domaine=raw.get("buyer_domain"))


def _construire_signal(doc, compte, categories, ligne, methode, confiance):
    raw = doc.get("raw") or {}
    categorie = categories[0] if categories else "appel_offres"

    detail = doc.get("excerpt") or doc.get("title") or ""
    # Une date de fin de marché est une fenêtre de reconquête connue à l'avance :
    # c'est l'information la plus actionnable d'un avis d'attribution.
    if raw.get("contract_end_date"):
        detail += f" · Renouvellement à prévoir avant {raw['contract_end_date']}"

    return {
        "account_id": compte["id"],
        "company_id": compte.get("company_id"),
        "document_id": doc["id"],
        "type": TYPE_PAR_CATEGORIE.get(categorie, "autre"),
        "product_line": ligne or "both",
        "title": (doc.get("title") or "")[:300],
        "detail": detail[:1000],
        "observed_at": doc.get("published_at"),
        "source_url": doc.get("url"),
        "source_verified": True,          # source officielle sous licence ouverte
        "confidence": confiance,
        "match_method": methode,
        "match_confidence": confiance,
        "lang": doc.get("lang"),
        "country_code": _pays(raw),
        "status": "nouveau",
    }


def _pays(raw):
    """Code pays ISO-2 depuis les codes NUTS/ISO-3 renvoyés par TED."""
    corr = {"FRA": "FR", "DEU": "DE", "GBR": "GB", "BEL": "BE", "ESP": "ES", "ITA": "IT"}
    for valeur in raw.get("place_of_performance") or []:
        if valeur in corr:
            return corr[valeur]
    return None


def main():
    ap = argparse.ArgumentParser(description="Passage quotidien de veille.")
    ap.add_argument("--collecte", action="store_true", help="collecte seule")
    ap.add_argument("--traitement", action="store_true", help="traitement seul")
    ap.add_argument("--dry-run", action="store_true", help="n'écrit rien")
    args = ap.parse_args()

    if not args.dry_run:
        exiger_supabase()

    tout = not (args.collecte or args.traitement)
    debut = time.time()
    collectes = None

    if tout or args.collecte:
        print("Collecte…")
        collectes = collecter(args.dry_run)
        print(f"  {len(collectes)} documents collectés")

    if tout or args.traitement:
        print("Traitement…")
        # En dry-run, on enchaîne en mémoire : rien n'a été écrit à relire.
        vus, retenus, signaux = traiter(
            args.dry_run,
            documents=collectes if (args.dry_run and tout) else None,
        )
        taux = (100 * retenus / vus) if vus else 0
        print(f"  {vus} vus · {retenus} retenus ({taux:.0f} %) · {signaux} signaux")

    print(f"Terminé en {time.time() - debut:.1f} s")


if __name__ == "__main__":
    main()
