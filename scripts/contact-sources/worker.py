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
from datetime import datetime, timezone, timedelta

# Réutilise les fonctions importables des scripts existants (même dossier).
from discover_free import discover_company
from waterfall import enrich_email
from site_finder import find_official_site
from phone_finder import find_standard, find_email

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
    # Leads Salesforce : pas de domaine deviné (setippsetipp.com…) — sans domaine
    # vérifié par la collecte web, on n'invente pas d'email.
    if not domain and company and not params.get("no_guess_domain"):
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
        "source": contact.get("source") or "scrapling:duckduckgo+linkedin",
        "raw": contact,
    }
    if email_info and email_info.get("best"):
        best = email_info["best"]
        row["email"] = best["email"]
        row["email_confidence"] = best["confidence"]
        row["email_source"] = ", ".join(best["sources"])
    sb("scrape_results", method="POST", body=row, prefer="return=minimal")


FIND_SITE_BATCH = _int_env("FIND_SITE_BATCH", 15)   # recherches de site par run (rapides)


def process_find_website(job):
    """Job find_website : site officiel vérifié par SIREN → écrit sur le compte."""
    job_id, params = job["id"], job.get("params") or {}
    update_job(job_id, status="running", started_at=now_iso(), progress=10)
    url, status, trials = find_official_site(params.get("company") or "", params.get("commune") or "", params.get("siren") or "")
    account_id = params.get("account_id")
    if url and account_id:
        host = urllib.parse.urlparse(url).hostname.removeprefix("www.")
        # web_intel_at remis à zéro : la collecte de l'appli repasse sur ce site.
        sb(f"accounts?id=eq.{account_id}", method="PATCH",
           body={"website": url, "domain": host, "web_intel_at": None})
    # Candidats et raisons gardés en base (privée) pour diagnostic — jamais dans
    # les journaux, publics avec le dépôt.
    update_job(job_id, status="done", progress=100, finished_at=now_iso(),
               stats={"found": 1 if url else 0, "enriched": 0, "blocked": 0, "match": status,
                      "tested": len(trials), "trials": [{"host": h, "why": w} for h, w in trials]})
    print(f"✓ job {job_id} [find_website] {status or 'aucun site retenu'} ({len(trials)} candidat(s))")


FIND_PHONE_BATCH = _int_env("FIND_PHONE_BATCH", 40)  # recherches de standard par run (1-2 requêtes chacune)


def process_find_phone(job):
    """Job find_phone : standard lu dans les extraits de recherche → écrit sur le compte s'il n'en a pas."""
    job_id, params = job["id"], job.get("params") or {}
    account_id = params.get("account_id")
    update_job(job_id, status="running", started_at=now_iso(), progress=10)
    rows = sb(f"accounts?id=eq.{account_id}&select=standard_phone,phones:web_intel->phones") if account_id else []
    if not rows:
        update_job(job_id, status="done", progress=100, finished_at=now_iso(), stats={"found": 0, "skip": "compte absent"})
        print(f"✓ job {job_id} [find_phone] compte absent")
        return
    if rows[0].get("standard_phone") or rows[0].get("phones"):
        update_job(job_id, status="done", progress=100, finished_at=now_iso(), stats={"found": 0, "skip": "déjà un numéro"})
        print(f"✓ job {job_id} [find_phone] déjà un numéro")
        return
    number, sources = find_standard(params.get("company") or "", params.get("commune") or "")
    if number:
        # Jamais par-dessus un numéro saisi entre-temps.
        sb(f"accounts?id=eq.{account_id}&standard_phone=is.null", method="PATCH",
           body={"standard_phone": number, "standard_source": f"recherche web ({sources} source{'s' if sources > 1 else ''}), à vérifier"})
    update_job(job_id, status="done", progress=100, finished_at=now_iso(), stats={"found": 1 if number else 0, "sources": sources})
    print(f"✓ job {job_id} [find_phone] {'numéro trouvé' if number else 'aucun numéro sûr'}")


def process_find_email(job):
    """Job find_email : email de la société lu dans les extraits de recherche → écrit s'il n'y en a pas."""
    job_id, params = job["id"], job.get("params") or {}
    account_id = params.get("account_id")
    update_job(job_id, status="running", started_at=now_iso(), progress=10)
    rows = sb(f"accounts?id=eq.{account_id}&select=found_email,standard_phone,phones:web_intel->phones") if account_id else []
    if not rows or rows[0].get("found_email"):
        update_job(job_id, status="done", progress=100, finished_at=now_iso(), stats={"found": 0, "skip": "absent ou déjà un email"})
        print(f"✓ job {job_id} [find_email] rien à faire")
        return
    email, sources, phone = find_email(params.get("company") or "", params.get("commune") or "")
    if email:
        sb(f"accounts?id=eq.{account_id}&found_email=is.null", method="PATCH",
           body={"found_email": email, "found_email_source": f"recherche web ({sources} source{'s' if sources > 1 else ''})"})
    if phone and not rows[0].get("standard_phone") and not rows[0].get("phones"):
        sb(f"accounts?id=eq.{account_id}&standard_phone=is.null", method="PATCH",
           body={"standard_phone": phone, "standard_source": "recherche web (avec l'email), à vérifier"})
    update_job(job_id, status="done", progress=100, finished_at=now_iso(), stats={"found": 1 if email else 0, "sources": sources})
    print(f"✓ job {job_id} [find_email] {'email trouvé' if email else 'aucun email sûr'}")


def process_job(job):
    job_id = job["id"]
    kind = job["kind"]
    params = job.get("params") or {}
    if kind == "find_website":
        return process_find_website(job)
    if kind == "find_phone":
        return process_find_phone(job)
    if kind == "find_email":
        return process_find_email(job)
    limit = int(params.get("limit") or DEFAULT_LIMIT)
    do_enrich = kind in ("enrich", "discover_and_enrich")
    do_discover = kind in ("discover", "discover_and_enrich")

    update_job(job_id, status="running", started_at=now_iso(), progress=5)
    company, domain, account_id = resolve_target(params)
    # Dépôt public = journaux publics : aucun nom de société ni de personne.
    print(f"▶ job {job_id} [{kind}] (domaine {'connu' if domain else 'absent'})")
    strict = params.get("strict_match", False)

    found = enriched = blocked = 0

    # ── Découverte ────────────────────────────────────────────────────────────
    contacts = []
    if do_discover:
        contacts, blk = discover_company(company, roles=params.get("roles") or None, max_profiles=limit,
                                         extract=True, log=print, must_match=strict, quiet=True)
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
                print(f"  ⚠ enrich KO : {str(e)[:80]}")

        email = (email_info or {}).get("best", {}).get("email") if email_info else None
        if is_optout(email):
            print("  ⊘ opt-out, ignoré")
        elif kind != "enrich" and already_seen(contact.get("linkedin_url"), email):
            print("  = doublon, ignoré")
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
    # Auto-réparation : un job resté "running" > 30 min vient d'un timeout du runner
    # (le job a été réclamé mais le run s'est arrêté avant la fin). On le repasse en
    # pending — le dédup already_seen() évite de réécrire les contacts déjà extraits.
    stale = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    try:
        sb(f"scrape_jobs?status=eq.running&started_at=lt.{urllib.parse.quote(stale)}",
           method="PATCH", body={"status": "pending", "started_at": None})
    except Exception:  # noqa: BLE001 — jamais bloquant
        pass

    # Leads Salesforce (agent hebdo) d'abord : ce sont les comptes appelés cette
    # semaine ; la veille automatique (created_by=auto) complète le lot.
    # Recherches de site : rapides, lot à part (ne mangent pas le quota LinkedIn).
    sites = sb(f"scrape_jobs?status=eq.pending&kind=eq.find_website&order=created_at.asc&limit={FIND_SITE_BATCH}") or []
    phones = sb(f"scrape_jobs?status=eq.pending&kind=in.(find_phone,find_email)&order=created_at.asc&limit={FIND_PHONE_BATCH}") or []
    jobs = sb(f"scrape_jobs?status=eq.pending&kind=not.in.(find_website,find_phone,find_email)&created_by=eq.leads-agent&order=created_at.asc&limit={JOB_BATCH}") or []
    # Anciens comptes suivis (veille) : seulement si explicitement réactivé.
    include_auto = (os.environ.get("SCRAPE_INCLUDE_AUTO") or "").strip().lower() == "true"
    if include_auto and len(jobs) < JOB_BATCH:
        jobs += sb(f"scrape_jobs?status=eq.pending&kind=not.in.(find_website,find_phone,find_email)&or=(created_by.is.null,created_by.neq.leads-agent)&order=created_at.asc&limit={JOB_BATCH - len(jobs)}") or []
    # Standards d'abord (une ou deux requêtes chacun : le plus utile pour appeler),
    # puis sites, puis décideurs.
    jobs = phones + sites + jobs
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
