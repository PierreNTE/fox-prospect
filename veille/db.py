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

    `resolution=ignore-duplicates` s'appuie sur la contrainte d'unicité de
    url_hash : relancer le passage quotidien ne crée jamais de doublon, sans
    qu'aucun code n'ait à le vérifier.
    """
    if not documents:
        return 0
    sb(
        "veille_documents",
        "POST",
        documents,
        prefer="resolution=ignore-duplicates,return=minimal",
    )
    return len(documents)


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
    """Crée un signal, sans doublon.

    L'index unique (document_id, account_id) garantit qu'un même document ne
    produit qu'un signal par compte, même si le passage est relancé.
    """
    sb(
        "company_signals",
        "POST",
        [signal],
        prefer="resolution=ignore-duplicates,return=minimal",
    )


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
