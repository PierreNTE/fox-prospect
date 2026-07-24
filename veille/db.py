"""Accès Supabase — SEUL point d'écriture du pipeline.

Les modules de collecte et de traitement retournent des objets ; ils ne
persistent rien. Concentrer les écritures ici rend l'idempotence vérifiable
en un seul endroit.

On utilise urllib (stdlib) plutôt qu'un client Supabase, par cohérence avec
scripts/contact-sources/worker.py et pour garder l'installation légère : sur
un budget de minutes GitHub Actions, chaque dépendance se paie.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

from config import SB_KEY, SB_URL


def sb(path, method="GET", body=None, prefer=None, timeout=30):
    """Appel REST PostgREST avec la clé service_role."""
    url = f"{SB_URL}/rest/v1/{path}"
    headers = {
        "apikey": SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            brut = r.read().decode()
            return json.loads(brut) if brut else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Supabase {method} {path} → {e.code} {e.read().decode()[:300]}")


# ── Sources ─────────────────────────────────────────────────────────────────

def charger_sources(kind=None):
    """Sources actives, éventuellement filtrées par type."""
    q = "veille_sources?enabled=eq.true&select=*&order=id"
    if kind:
        q += f"&kind=eq.{urllib.parse.quote(kind)}"
    return sb(q) or []


def maj_source(source_id, sync_cursor=None, erreur=None):
    """Met à jour le curseur d'incrémentalité et l'état de santé d'une source."""
    champs = {"last_run_at": "now()"}
    if erreur:
        champs["last_error"] = erreur[:500]
    else:
        champs["last_ok_at"] = "now()"
        champs["last_error"] = None
        if sync_cursor is not None:
            champs["sync_cursor"] = sync_cursor
    sb(f"veille_sources?id=eq.{source_id}", "PATCH", champs, prefer="return=minimal")


# ── Documents ───────────────────────────────────────────────────────────────

def inserer_documents(documents):
    """Insère les documents collectés en ignorant les doublons.

    Deux protections, parce qu'il y a deux sources de doublons distinctes et
    qu'aucune des deux n'était couverte au départ :

    1. `on_conflict=url_hash` — SANS ce paramètre, PostgREST vise la clé
       PRIMAIRE et laisse passer les conflits sur les autres contraintes
       d'unicité. Mesuré : 800 avis TED perdus en une seule exécution, la
       requête entière rejetée en 409.

    2. Déduplication DANS le lot — un même avis peut revenir sur deux pages de
       l'API TED. Postgres refuse d'appliquer ON CONFLICT deux fois à la même
       ligne dans un seul INSERT ; le conflit doit donc être réglé avant
       l'envoi, pas par la base.
    """
    if not documents:
        return 0
    uniques, vus = [], set()
    for d in documents:
        h = d.get("url_hash")
        if h and h in vus:
            continue
        if h:
            vus.add(h)
        uniques.append(d)

    sb(
        "veille_documents?on_conflict=url_hash",
        "POST",
        uniques,
        prefer="resolution=ignore-duplicates,return=minimal",
    )
    return len(uniques)


def documents_a_traiter(statuts, limite=500):
    """File de reprise : les documents restant à traiter, les plus anciens d'abord."""
    liste = ",".join(statuts)
    return sb(
        f"veille_documents?status=in.({liste})&select=*"
        f"&order=collected_at.asc&limit={limite}"
    ) or []


def maj_document(document_id, **champs):
    sb(f"veille_documents?id=eq.{document_id}", "PATCH", champs, prefer="return=minimal")


def ecarter_document(document_id, raison):
    maj_document(document_id, status="ecarte", reject_reason=raison[:200], processed_at="now()")


# ── Comptes et signaux ──────────────────────────────────────────────────────

def comptes_suivis():
    """Comptes inclus dans la veille automatique (drapeau auto_watch existant)."""
    return sb("accounts?auto_watch=eq.true&select=id,name,domain,company_id") or []


def creer_signal(signal):
    """Crée un signal. Renvoie True s'il est nouveau, False s'il existait déjà.

    Les deux index d'unicité de la table — (document_id, account_id) et
    source_url — sont PARTIELS. `on_conflict` de PostgREST ne sait pas viser un
    index partiel : il produit un ON CONFLICT sans prédicat, que Postgres
    rejette. Comme les signaux sont insérés un par un, intercepter le conflit
    est ici plus exact qu'un mécanisme générique — et c'est précisément
    l'intention : un doublon est bénin, il ne doit pas arrêter le passage.

    On n'avale QUE la violation d'unicité (23505). Toute autre erreur remonte :
    une contrainte de type ou de valeur violée est un bug à voir, pas à taire.
    """
    try:
        sb("company_signals", "POST", [signal], prefer="return=minimal")
        return True
    except RuntimeError as e:
        if "23505" in str(e):
            return False
        raise


# ── Supervision ─────────────────────────────────────────────────────────────

def journaliser_run(stage, source_id=None, collected=0, kept=0, signals=0,
                    llm_calls=0, duration_ms=None, erreur=None, run_ref=None):
    """Journalise une étape. On mesure les VOLUMES autant que les erreurs :
    une source qui change de format et renvoie zéro résultat ne lève rien."""
    sb("pipeline_runs", "POST", [{
        "run_ref": run_ref,
        "source_id": source_id,
        "stage": stage,
        "collected": collected,
        "kept": kept,
        "signals": signals,
        "llm_calls": llm_calls,
        "duration_ms": duration_ms,
        "error": erreur[:500] if erreur else None,
        "finished_at": "now()",
    }], prefer="return=minimal")
