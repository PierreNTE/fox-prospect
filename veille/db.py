"""Accès Supabase — SEUL point d'écriture du pipeline.

Les modules de collecte et de traitement retournent des objets ; ils ne
persistent rien. Concentrer les écritures ici rend l'idempotence vérifiable
en un seul endroit.

On utilise urllib (stdlib) plutôt qu'un client Supabase, par cohérence avec
scripts/contact-sources/worker.py et pour garder l'installation légère : sur
un budget de minutes GitHub Actions, chaque dépendance se paie.
"""

import datetime
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


def maj_signal(signal_id, **champs):
    sb(f"company_signals?id=eq.{signal_id}", "PATCH", champs, prefer="return=minimal")


# ── Étage IA ────────────────────────────────────────────────────────────────

def signaux_sans_embedding(limite=200):
    """Anti-jointure signaux / vecteurs — inexprimable en PostgREST, d'où la RPC."""
    return sb("rpc/veille_signaux_sans_embedding", "POST", {"p_limite": limite}) or []


def enregistrer_embeddings(lignes):
    """Écrit les vecteurs. `embedding` est une chaîne « [0.1,…] », forme d'entrée
    native de pgvector : PostgREST transmet du JSON, Postgres fait la conversion.

    Upsert et non insert : un signal dont le texte a été enrichi par le résumé
    mérite un vecteur recalculé, sans qu'il faille d'abord supprimer l'ancien.
    """
    if not lignes:
        return 0
    sb("signal_embeddings?on_conflict=signal_id", "POST", lignes,
       prefer="resolution=merge-duplicates,return=minimal")
    return len(lignes)


def themes_a_vectoriser():
    """Thèmes actifs dont le vecteur manque — nouveaux, ou requête modifiée
    (le trigger de la migration v16 remet alors l'embedding à NULL)."""
    return sb("veille_themes?enabled=eq.true&embedding=is.null&select=id,label,query") or []


def maj_theme_vecteur(theme_id, vecteur):
    sb(f"veille_themes?id=eq.{theme_id}", "PATCH",
       {"embedding": vecteur, "embedded_at": "now()"}, prefer="return=minimal")


def cout_mois_courant():
    """Dépense Anthropic du mois en cours, en euros — MÊME source que lib/budget.js.

    La somme est faite ici plutôt qu'en SQL par symétrie avec l'application :
    une seule règle de calcul, appliquée aux mêmes lignes, quel que soit le
    demandeur. Le volume est de l'ordre de quelques centaines de lignes.
    """
    debut = datetime.datetime.now(datetime.timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ).isoformat()
    lignes = sb(f"ai_runs?select=cost_eur&created_at=gte.{urllib.parse.quote(debut)}") or []
    return sum(float(l.get("cost_eur") or 0) for l in lignes)


def journaliser_ai_run(route, input_tokens=0, output_tokens=0, cost_eur=0, account_id=None):
    """Journalise un appel LLM dans la table de l'application.

    Le pipeline n'a pas sa propre comptabilité : la jauge de budget affichée
    dans Réglages doit voir la veille, sinon le plafond mensuel protège une
    moitié du système et ignore l'autre.
    """
    sb("ai_runs", "POST", [{
        "route": route,
        "account_id": account_id,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_eur": cost_eur,
    }], prefer="return=minimal")


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
