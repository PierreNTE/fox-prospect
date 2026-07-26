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
from config import (FENETRE_JOURS, FENETRE_JOURS_PRESSE, MAX_DOCS_PAR_SOURCE,
                    PAYS_MVP, RUN_REF,
                    exiger_supabase)
from pipeline import embed, filtre, juger
from pipeline.resolve import Annuaire
from sources import rss, ted

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


# Connecteurs disponibles. Ajouter une source revient à écrire un module dans
# sources/ et une ligne ici — le pipeline n'a pas à être touché.
COLLECTEURS = {
    "ted": ted.collecter,
    "rss": rss.collecter,
}

# Sources de repli, utilisées uniquement en dry-run sans identifiants Supabase.
# Permet d'éprouver un connecteur en local sans toucher à la base.
SOURCES_LOCALES = [
    {"id": None, "kind": "ted", "label": "TED (test local)",
     "config": {"notice_types": ["cn-standard", "can-standard"]}},
    {"id": None, "kind": "rss", "label": "Le Monde Informatique (test local)",
     "url": "https://www.lemondeinformatique.fr/rss/rss.xml",
     "country_code": "FR", "config": {"lang": "fr"}},
    # Flux rattaché à un compte : éprouve la stratégie « source », celle qui ne
    # peut pas produire de faux positif.
    {"id": None, "kind": "rss", "label": "TotalEnergies — newsroom (test local)",
     "url": "https://totalenergies.com/newsroom/feed/",
     "country_code": "FR", "config": {"portee": "compte", "lang": "fr"},
     "account_id": "8ec098ac-1881-432e-aac1-9a3cefba7649"},
]


def _sources():
    from config import SB_URL
    if not SB_URL:
        print("  (pas d'identifiants Supabase : sources de test intégrées)")
        return SOURCES_LOCALES
    return [s for s in db.charger_sources() if s.get("kind") in COLLECTEURS]


def _fenetre(source):
    """Profondeur de collecte, selon la cadence de publication de la source.

    Un flux rattaché à un compte est une salle de presse : elle publie quelques
    fois par mois, et chacun de ses communiqués porte un rattachement CERTAIN.
    Lui appliquer la fenêtre courte de TED — qui publie des centaines d'avis par
    jour — revenait à ne la lire que les jours où elle publiait, c'est-à-dire
    presque jamais.
    """
    return FENETRE_JOURS_PRESSE if source.get("account_id") else FENETRE_JOURS


def collecter(dry_run=False):
    """Étage de collecte. Renvoie les lignes prêtes pour veille_documents."""
    collectes = []
    for source in _sources():
        debut = time.time()
        try:
            documents, curseur = COLLECTEURS[source["kind"]](
                source, depuis_jours=_fenetre(source),
                pays=PAYS_MVP, plafond=MAX_DOCS_PAR_SOURCE,
            )
            lignes = [d.en_ligne() for d in documents]
            print(f"  {source['label']} : {len(lignes)} documents")
            if not dry_run:
                db.inserer_documents(lignes)
                db.maj_source(source["id"], sync_cursor=curseur, collectes=len(lignes))
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


def _comptes(chemin=None):
    """Annuaire des comptes suivis, ou repli sur un fichier en dry-run.

    Symétrique de `_sources` : sans ce repli, aucun étage de rattachement n'est
    éprouvable hors ligne, et c'est précisément l'étage où les régressions
    coûtent le plus cher — un faux rattachement écrit une information fausse
    sur une fiche client.
    """
    if chemin:
        import json
        return json.loads(Path(chemin).read_text(encoding="utf-8"))
    return db.comptes_suivis()


def traiter(dry_run=False, documents=None, comptes=None):
    """Étages filtre → rattachement → signal.

    `documents` permet d'enchaîner en mémoire en dry-run : sans écriture en
    base, l'étage suivant n'aurait rien à lire. C'est le mode utilisé pour
    régler le filtre lexical sans polluer la base.
    """
    debut = time.time()
    annuaire = Annuaire(_comptes(comptes))
    print(f"  annuaire : {len(annuaire.comptes)} comptes suivis")

    if documents is None:
        documents = db.documents_a_traiter(["collecte", "extrait"], limite=1000)
    retenus = signaux = candidats = 0
    ecartes = {}
    # Les signaux ne sont plus écrits dans cette boucle : l'étage de jugement a
    # un plafond de dépense, et le dépenser dans l'ordre d'arrivée des documents
    # reviendrait à le laisser à la première source venue. On collecte donc les
    # candidats, on les ordonne par fragilité, puis on écrit.
    a_creer = []

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
            # Mesuré sur données réelles : AUCUN des avis TED ne correspond aux
            # comptes suivis, parce que TED est de la commande publique et que
            # le portefeuille est composé de groupes privés. Les écarter tous
            # reviendrait à jeter la valeur de la source.
            #
            # Un acheteur public identifié devient donc un CANDIDAT À LA
            # PROSPECTION — statut « classe », visible dans la vue veille — et
            # non un signal sur une fiche existante. Le secteur public fait
            # partie du périmètre commercial.
            acheteur = (doc.get("raw") or {}).get("buyer_name")
            if acheteur:
                candidats += 1
                ecartes["candidat prospection (acheteur public)"] = \
                    ecartes.get("candidat prospection (acheteur public)", 0) + 1
                if not dry_run:
                    db.maj_document(doc["id"], status="classe",
                                    reject_reason=f"candidat: {acheteur[:150]}",
                                    processed_at="now()")
            else:
                ecartes["aucun compte suivi"] = ecartes.get("aucun compte suivi", 0) + 1
                if not dry_run:
                    db.ecarter_document(doc["id"], "aucun compte suivi correspondant")
            continue

        a_creer.append((doc, compte, categories, ligne, methode, confiance))

    # ── Jugement puis écriture ──────────────────────────────────────────────
    juge = juger.Juge(dry_run)
    for doc, compte, categories, ligne, methode, confiance in sorted(a_creer, key=_priorite_jugement):
        verdict = juge.juger(doc, compte, categories, methode)

        # Le modèle peut REFUSER un rattachement que le filtre lexical avait
        # laissé passer. C'est son seul vrai pouvoir, et la raison d'être de
        # l'étage : écrire une information fausse sur une fiche client coûte
        # plus cher que de manquer un signal.
        if verdict and not verdict["pertinent"]:
            motif = f"IA : {verdict['raison'] or 'hors périmètre'}"
            ecartes[motif[:60]] = ecartes.get(motif[:60], 0) + 1
            if not dry_run:
                db.ecarter_document(doc["id"], motif)
            continue

        signal = _construire_signal(doc, compte, categories, ligne, methode, confiance, verdict)
        print(f"  → {compte['name']} : {signal['type']}/{signal['product_line']} "
              f"({methode} {confiance}) — {signal['title'][:60]}")
        if not dry_run:
            db.creer_signal(signal)
            db.maj_document(doc["id"], status="rattache", processed_at="now()")
        signaux += 1

    print(f"  {juge.bilan()}")

    # Le détail des rejets est ce qui rend le filtre réglable : sans lui, on ne
    # sait pas s'il est trop sévère ou trop laxiste.
    for motif, n in sorted(ecartes.items(), key=lambda kv: -kv[1]):
        print(f"  écarté · {motif} : {n}")

    if candidats:
        print(f"  {candidats} acheteurs publics identifiés comme candidats à la prospection")

    if not dry_run:
        db.journaliser_run("traitement", collected=len(documents), kept=retenus,
                           signals=signaux, llm_calls=juge.appels, run_ref=RUN_REF,
                           duration_ms=int((time.time() - debut) * 1000))
    return len(documents), retenus, signaux


def _priorite_jugement(candidat):
    """Ordre de passage devant le modèle : le plus fragile d'abord.

    Tous les candidats sont jugés — une salle de presse tranche l'appartenance
    au compte, jamais l'intérêt commercial. Mais le plafond d'appels est une
    ressource rare : quand il ne suffit pas, il doit aller aux documents qui ont
    DEUX questions à trancher (« est-ce ce compte ? » et « est-ce un signal ? »)
    plutôt qu'à ceux qui n'en ont qu'une.
    """
    _doc, _compte, _categories, _ligne, methode, _confiance = candidat
    rang = {"mention": 0, "nom": 1}.get(methode, 2)
    # À fragilité égale, l'étranger passe devant : c'est là que le résumé
    # français apporte le plus (le commercial ne lit pas un avis allemand).
    langue = 0 if (_doc.get("lang") or "fr") != "fr" else 1
    return (rang, langue)


def _rattacher(doc, annuaire):
    """Rattache un document, selon la stratégie déclarée par sa source.

    · « source »   (salle de presse) : la source EST le compte. Certain.
    · « acheteur » (TED)             : l'entité est nommée, on la résout.
    · « mention »  (presse générale) : l'entité est inconnue, on balaie le
      texte — la seule des trois qui puisse se tromper.
    """
    raw = doc.get("raw") or {}
    strategie = raw.get("strategie_rattachement")

    if strategie == "source":
        compte = annuaire.par_id.get(str(raw.get("account_id")))
        # Un compte retiré de la veille (auto_watch décoché) sort de l'annuaire
        # alors que sa source reste active : on n'invente pas de rattachement.
        return (compte, "source", 1.0) if compte else (None, None, 0.0)

    if strategie == "mention":
        texte = f"{doc.get('title', '')} {doc.get('excerpt', '')}"
        return annuaire.chercher_dans_texte(texte)
    return annuaire.resoudre(nom=raw.get("buyer_name"), domaine=raw.get("buyer_domain"))


def _construire_signal(doc, compte, categories, ligne, methode, confiance, verdict=None):
    """Assemble le signal. `verdict` est le jugement du modèle, ou None.

    Le verdict ENRICHIT, il n'écrase pas : `detail` reste le texte de la source
    et `summary` porte la reformulation française. Le jour où le jugement se
    révèle mauvais, on vide une colonne sans avoir perdu la source.
    """
    raw = doc.get("raw") or {}
    categorie = categories[0] if categories else "appel_offres"

    detail = doc.get("excerpt") or doc.get("title") or ""
    # Une date de fin de marché est une fenêtre de reconquête connue à l'avance :
    # c'est l'information la plus actionnable d'un avis d'attribution.
    if raw.get("contract_end_date"):
        detail += f" · Renouvellement à prévoir avant {raw['contract_end_date']}"

    signal = {
        "account_id": compte["id"],
        "company_id": compte.get("company_id"),
        # `.get` et non `[...]` : en dry-run les documents n'ont jamais été
        # insérés, donc pas d'identifiant. Le signal reste constructible, ce
        # qui est tout l'intérêt du mode.
        "document_id": doc.get("id"),
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

    if verdict:
        from config import MODELE_LLM
        signal["summary"] = verdict["resume"]
        signal["relevance"] = verdict["pertinence"]
        signal["judged_model"] = MODELE_LLM
        signal["judged_at"] = "now()"
        if verdict["type"]:
            signal["type"] = verdict["type"]
        if verdict["ligne"]:
            signal["product_line"] = verdict["ligne"]
        # Colonne dédiée, et non noyée dans le texte : c'est ce qui rend le
        # droit d'opposition RGPD applicable à une nomination (voir v12).
        if verdict["personne"] and signal["type"] == "nomination":
            signal["person_name"] = verdict["personne"]

    return signal


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
    ap.add_argument("--embed", action="store_true", help="vectorisation seule (briques NLP)")
    ap.add_argument("--dry-run", action="store_true", help="n'écrit rien")
    ap.add_argument("--comptes", help="JSON de comptes, pour éprouver hors ligne")
    args = ap.parse_args()

    if not args.dry_run:
        exiger_supabase()

    # La vectorisation est HORS du passage par défaut : elle exige torch, que le
    # workflow n'installe que dans une étape séparée. Ainsi une roue Python
    # cassée ne fait jamais tomber la collecte, qui est l'étage irremplaçable.
    tout = not (args.collecte or args.traitement or args.embed)
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
            comptes=args.comptes,
        )
        taux = (100 * retenus / vus) if vus else 0
        print(f"  {vus} vus · {retenus} retenus ({taux:.0f} %) · {signaux} signaux")

    if args.embed:
        print("Vectorisation…")
        themes = embed.vectoriser_themes(args.dry_run)
        signaux_vus = embed.vectoriser_signaux(args.dry_run)
        print(f"  {themes} thème(s) · {signaux_vus} signal(aux)")

    print(f"Terminé en {time.time() - debut:.1f} s")


if __name__ == "__main__":
    main()
