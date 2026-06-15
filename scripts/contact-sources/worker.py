#!/usr/bin/env python3
"""
Orchestrateur du worker de scraping — exécuté par GitHub Actions (cron / dispatch).

Boucle :
  1. lit les jobs `pending` de Supabase (FIFO, plafonné),
  2. pour chacun : découverte (discover_free) + enrichissement email (waterfall),
  3. écrit les contacts dans `scrape_results` (opt-out + dédup respectés),
  4. fait progresser status/progress/stats au fil de l'eau,
  5. termine en `done` (ou `error`), journalise un event.

Dégradation gracieuse : une source qui bloque est comptée dans `stats.blocked`,
loggée, et n'interrompt jamais le job. Aucun secret en dur (env GitHub Actions).
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

# Réutilise les fonctions importables des scripts existants (même dossier).
from discover_free import discover_company
from waterfall import enrich_email

SB_URL = os.environ.get("SUPABASE_URL")
SB_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not (SB_URL and SB_KEY):
    sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY requis (secrets GitHub Actions).")

def _int_env(name, default):
    """int d'une variable d'env, tolérant aux valeurs absentes OU vides.
    (GitHub Actions transmet une Variable non définie comme chaîne vide ''.)"""
    v = (os.environ.get(name) or "").strip()
    try:
        return int(v) if v else default
    except ValueError:
        return default


JOB_BATCH = _int_env("SCRAPE_JOB_BATCH", 5)        # jobs traités par run
DEFAULT_LIMIT = _int_env("SCRAPE_PROFILE_LIMIT", 8)  # profils/société


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ── Helpers REST Supabase (service_role) ──────────────────────────────────────

def sb(path, method="GET", body=None, prefer=None):
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
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Supabase {method} {path} → {e.code} {e.read().decode()[:200]}")


def update_job(job_id, **fields):
    sb(f"scrape_jobs?id=eq.{job_id}", method="PATCH", body=fields)


def log_event(note, account_id=None):
    # kind='auto_action' : autorisé dans tous les schémas de events (pas d'ALTER).
    payload = {"kind": "auto_action", "note": note}
    try:
        sb("events", method="POST", body=payload, prefer="return=minimal")
    except Exception as e:  # noqa: BLE001 — le logging ne doit jamais casser un job
        print(f"  (event non journalisé : {e})")


# ── Conformité + dédup ────────────────────────────────────────────────────────

def is_optout(email):
    if not email:
        return False
    try:
        rows = sb(f"optout?email=eq.{urllib.parse.quote(email.lower())}&select=email&limit=1")
        return bool(rows)
    except Exception:  # noqa: BLE001
        return False  # en cas de doute on n'insère pas plus, le promote re-vérifie


def already_seen(linkedin_url, email):
    try:
        if linkedin_url:
            rows = sb(f"scrape_results?linkedin_url=eq.{urllib.parse.quote(linkedin_url)}&select=id&limit=1")
            if rows:
                return True
        if email:
            rows = sb(f"scrape_results?email=eq.{urllib.parse.quote(email)}&select=id&limit=1")
            if rows:
                return True
    except Exception:  # noqa: BLE001
        pass
    return False


# ── Utilitaires ───────────────────────────────────────────────────────────────

def bare_domain(value):
    """https://www.acme.fr/contact → acme.fr"""
    if not value:
        return ""
    v = value.strip().replace("https://", "").replace("http://", "")
    v = v.split("/")[0]
    if v.startswith("www."):
        v = v[4:]
    return v.lower()


def split_name(full):
    parts = (full or "").split()
    if not parts:
        return "", ""
    return parts[0], (" ".join(parts[1:]) or parts[0])


def slug_domain(company):
    """Devinette de domaine si le compte n'en a pas (confiance basse)."""
    s = "".join(ch for ch in (company or "").lower() if ch.isalnum())
    return f"{s}.com" if s else ""


# ── Traitement d'un job ───────────────────────────────────────────────────────

def resolve_target(params):
    """Renvoie (company, domain, account_id) depuis params (+ compte Supabase)."""
    account_id = params.get("account_id")
    company = params.get("company") or ""
    domain = bare_domain(params.get("domain") or "")
    if account_id:
        try:
            rows = sb(f"accounts?id=eq.{account_id}&select=name,website,domain&limit=1")
            if rows:
                a = rows[0]
                company = company or a.get("name") or ""
                domain = domain or bare_domain(a.get("website") or a.get("domain") or "")
        except Exception:  # noqa: BLE001
            pass
    if not domain and company:
        domain = slug_domain(company)  # deviné, confiance basse
    return company, domain, account_id


def insert_result(job_id, account_id, company, contact, email_info):
    full_name = contact.get("name") or ""
    row = {
        "job_id": job_id,
        "account_id": account_id,
        "full_name": full_name,
        "title": contact.get("headline") or "",
        "company": company,
        "linkedin_url": contact.get("linkedin_url") or "",
        "source": "scrapling:duckduckgo+linkedin",
        "raw": contact,
    }
    if email_info and email_info.get("best"):
        best = email_info["best"]
        row["email"] = best["email"]
        row["email_confidence"] = best["confidence"]
        row["email_source"] = ", ".join(best["sources"])
    sb("scrape_results", method="POST", body=row, prefer="return=minimal")


def process_job(job):
    job_id = job["id"]
    kind = job["kind"]
    params = job.get("params") or {}
    limit = int(params.get("limit") or DEFAULT_LIMIT)
    do_enrich = kind in ("enrich", "discover_and_enrich")
    do_discover = kind in ("discover", "discover_and_enrich")

    update_job(job_id, status="running", started_at=now_iso(), progress=5)
    company, domain, account_id = resolve_target(params)
    print(f"▶ job {job_id} [{kind}] {company} (domaine: {domain or '—'})")

    found = enriched = blocked = 0

    # ── Découverte ────────────────────────────────────────────────────────────
    contacts = []
    if do_discover:
        contacts, blk = discover_company(company, max_profiles=limit, extract=True, log=print)
        blocked += blk
        found = len(contacts)
        update_job(job_id, progress=55, stats={"found": found, "enriched": 0, "blocked": blocked})
    elif kind == "enrich":
        # Enrichit les résultats existants de ce compte sans email.
        flt = f"account_id=eq.{account_id}" if account_id else f"company=eq.{urllib.parse.quote(company)}"
        rows = sb(f"scrape_results?{flt}&email=is.null&select=id,full_name,linkedin_url,raw&limit={limit}") or []
        contacts = [{"name": r.get("full_name"), "linkedin_url": r.get("linkedin_url"),
                     "_result_id": r["id"], **(r.get("raw") or {})} for r in rows]
        found = len(contacts)

    # ── Enrichissement + écriture ──────────────────────────────────────────────
    total = max(1, len(contacts))
    for i, contact in enumerate(contacts):
        email_info = None
        if do_enrich and domain:
            first, last = split_name(contact.get("name"))
            try:
                email_info = enrich_email(first, last, domain, do_search=True)
                if email_info.get("best"):
                    enriched += 1
            except Exception as e:  # noqa: BLE001
                blocked += 1
                print(f"  ⚠ enrich KO ({contact.get('name')}): {str(e)[:80]}")

        email = (email_info or {}).get("best", {}).get("email") if email_info else None
        if is_optout(email):
            print(f"  ⊘ opt-out, ignoré : {email}")
        elif kind != "enrich" and already_seen(contact.get("linkedin_url"), email):
            print(f"  = doublon, ignoré : {contact.get('name')}")
        elif kind == "enrich" and contact.get("_result_id"):
            # met à jour la ligne existante plutôt que d'en créer une
            if email_info and email_info.get("best"):
                b = email_info["best"]
                sb(f"scrape_results?id=eq.{contact['_result_id']}", method="PATCH",
                   body={"email": b["email"], "email_confidence": b["confidence"],
                         "email_source": ", ".join(b["sources"])})
        else:
            insert_result(job_id, account_id, company, contact, email_info)

        progress = 55 + int(40 * (i + 1) / total)
        update_job(job_id, progress=progress,
                   stats={"found": found, "enriched": enriched, "blocked": blocked})

    update_job(job_id, status="done", progress=100, finished_at=now_iso(),
               stats={"found": found, "enriched": enriched, "blocked": blocked})
    log_event(f"scrape:done job={job_id} found={found} enriched={enriched} blocked={blocked}")
    print(f"✓ job {job_id} done — found={found} enriched={enriched} blocked={blocked}")


# ── Boucle principale ─────────────────────────────────────────────────────────

def main():
    jobs = sb(f"scrape_jobs?status=eq.pending&order=created_at.asc&limit={JOB_BATCH}") or []
    print(f"=== worker : {len(jobs)} job(s) pending (cap {JOB_BATCH}) ===")
    if not jobs:
        return
    for job in jobs:
        try:
            process_job(job)
        except Exception as e:  # noqa: BLE001 — un job en erreur n'arrête pas les autres
            msg = str(e)[:400]
            print(f"✗ job {job['id']} ERROR: {msg}")
            try:
                update_job(job["id"], status="error", error=msg, finished_at=now_iso())
                log_event(f"scrape:error job={job['id']}")
            except Exception:  # noqa: BLE001
                pass
        time.sleep(2)  # respiration entre jobs


if __name__ == "__main__":
    main()
