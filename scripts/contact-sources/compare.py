#!/usr/bin/env python3
"""
Harnais de comparaison de sources de contacts — Fox Prospect.

Objectif : sur un même jeu de cibles (personne + entreprise), interroger
Pappers, Dropcontact et LinkedIn, puis tabuler qui trouve quoi (nom, poste,
email, téléphone). Sert à décider quelle(s) source(s) alimentent l'acquisition.

Tourne EN LOCAL. Lit les clés depuis ../../.env.local :
    PAPPERS_API_KEY        (https://www.pappers.fr/api — free tier dispo)
    DROPCONTACT_API_KEY    (https://www.dropcontact.com — payant)
    LINKEDIN_LI_AT         (cookie de session, optionnel — voir README, risque CGU)

Usage :
    python compare.py                  # tout le jeu de test
    python compare.py --only pappers   # une seule source
    python compare.py --case 0         # un seul cas

Chaque adaptateur est défensif : clé absente → "skipped", erreur → "error".
Rien n'est écrit en base : c'est un banc d'essai de lecture seule.
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    sys.exit("Manque python-dotenv. Réutilise le venv : ..\\scrapling-careers\\.venv")

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env.local")

PAPPERS_KEY = os.environ.get("PAPPERS_API_KEY")
DROPCONTACT_KEY = os.environ.get("DROPCONTACT_API_KEY")
LINKEDIN_COOKIE = os.environ.get("LINKEDIN_LI_AT")

# ── Jeu de test : décideurs IT plausibles dans de grands comptes FR ───────────
# Remplace par tes vraies cibles, ou branche-le sur tes prospects Supabase.
TEST_CASES = [
    {"first_name": "", "last_name": "", "role": "DSI", "company": "Decathlon", "domain": "decathlon.fr", "linkedin_url": ""},
    {"first_name": "", "last_name": "", "role": "RSSI", "company": "Groupama", "domain": "groupama.fr", "linkedin_url": ""},
    # Démo extraction LinkedIn (profil public connu) — remplace par tes vraies cibles.
    {"first_name": "Bill", "last_name": "Gates", "role": "Founder", "company": "Microsoft", "domain": "microsoft.com",
     "linkedin_url": "https://fr.linkedin.com/in/williamhgates"},
]

# ── HTTP helper ───────────────────────────────────────────────────────────────

def http(method, url, headers=None, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:300]}
    except Exception as e:  # noqa: BLE001
        return 0, {"error": str(e)}


# ── Adaptateur Pappers : entreprise + dirigeants ──────────────────────────────

def pappers(case):
    if not PAPPERS_KEY:
        return {"status": "skipped", "reason": "PAPPERS_API_KEY absente"}
    q = urllib.parse.urlencode({"api_token": PAPPERS_KEY, "q": case["company"], "precision": "standard"})
    code, data = http("GET", f"https://api.pappers.fr/v2/recherche?{q}")
    if code != 200:
        return {"status": "error", "code": code, "detail": data.get("error")}
    results = data.get("resultats") or []
    if not results:
        return {"status": "ok", "company": None, "dirigeants": []}
    top = results[0]
    reps = top.get("representants") or top.get("dirigeants") or []
    dirigeants = [
        {"nom": f"{r.get('prenom','')} {r.get('nom','')}".strip() or r.get("nom_complet", ""),
         "qualite": r.get("qualite", "")}
        for r in reps[:8]
    ]
    return {
        "status": "ok",
        "company": top.get("nom_entreprise") or top.get("denomination"),
        "siren": top.get("siren"),
        "dirigeants": dirigeants,
    }


# ── Adaptateur Dropcontact : enrichit nom+entreprise → email ──────────────────

def dropcontact(case):
    if not DROPCONTACT_KEY:
        return {"status": "skipped", "reason": "DROPCONTACT_API_KEY absente"}
    if not (case.get("first_name") and case.get("last_name")):
        return {"status": "skipped", "reason": "Dropcontact enrichit une personne connue (prénom+nom requis)"}
    headers = {"Content-Type": "application/json", "X-Access-Token": DROPCONTACT_KEY}
    payload = {
        "data": [{
            "first_name": case["first_name"],
            "last_name": case["last_name"],
            "company": case["company"],
            "website": case.get("domain", ""),
        }],
        "siren": True,
        "language": "fr",
    }
    code, data = http("POST", "https://api.dropcontact.io/batch", headers=headers, body=payload)
    if code not in (200, 201) or not data.get("request_id"):
        return {"status": "error", "code": code, "detail": data.get("error") or data}
    request_id = data["request_id"]
    # Traitement asynchrone : on interroge jusqu'à 'success'.
    for _ in range(12):
        time.sleep(5)
        code, res = http("GET", f"https://api.dropcontact.io/batch/{request_id}",
                         headers={"X-Access-Token": DROPCONTACT_KEY})
        if res.get("success"):
            row = (res.get("data") or [{}])[0]
            emails = row.get("email") or []
            return {
                "status": "ok",
                "email": emails[0]["email"] if emails else "",
                "email_qualif": emails[0].get("qualification", "") if emails else "",
                "phone": row.get("phone", ""),
                "civility": row.get("civility", ""),
            }
    return {"status": "error", "detail": "timeout (traitement Dropcontact non terminé)"}


# ── Adaptateur LinkedIn (Scrapling) — implémentation selon la méthode d'accès ──
# À COMPLÉTER une fois la méthode d'accès choisie (voir README) :
#   - logged-out  : rendement quasi nul (mur d'authentification)
#   - cookie li_at : plus de données, mais risque de bannissement + CGU
#   - provider     : Kaspr / Apollo / Lusha (API tierce, revend la donnée LinkedIn)

def linkedin(case):
    """Extrait nom/poste/entreprise/lieu d'un profil LinkedIn PUBLIC (déconnecté).
    Validé : StealthyFetcher charge le profil (200) et les balises meta exposent
    les données. Ne nécessite PAS de session → pas de risque de bannissement.
    Limite : il faut l'URL du profil (la *découverte* se fait via un moteur de
    recherche en amont, pas ici)."""
    url = case.get("linkedin_url")
    if not url:
        return {"status": "skipped", "reason": "pas de linkedin_url (découverte via search requise en amont)"}
    try:
        from scrapling.fetchers import StealthyFetcher
        StealthyFetcher.adaptive = True
        p = StealthyFetcher.fetch(url, headless=True, timeout=30000)
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "detail": str(e)[:160]}

    def meta(attr, val):
        try:
            return (p.css(f'meta[{attr}="{val}"]::attr(content)').get() or "").strip()
        except Exception:
            return ""

    import re
    title = ""
    try:
        title = (p.css("title::text").get() or "").strip()
    except Exception:
        pass
    desc = meta("name", "description") or meta("property", "og:description")
    ogtitle = meta("property", "og:title") or title
    name = re.split(r"\s[-–]\s", ogtitle)[0].replace("| LinkedIn", "").strip()

    def field(label):
        m = re.search(label + r"\s*:\s*([^·]+)", desc)
        return m.group(1).strip() if m else ""

    return {
        "status": "ok",
        "name": name,
        "headline": (desc.split(" · ")[0][:120] if desc else ""),
        "entreprise": field("Expérience"),
        "lieu": field("Lieu"),
    }


SOURCES = {"pappers": pappers, "dropcontact": dropcontact, "linkedin": linkedin}


def main():
    ap = argparse.ArgumentParser(description="Comparaison de sources de contacts")
    ap.add_argument("--only", choices=list(SOURCES), help="une seule source")
    ap.add_argument("--case", type=int, help="indice d'un seul cas de test")
    args = ap.parse_args()

    cases = [TEST_CASES[args.case]] if args.case is not None else TEST_CASES
    sources = {args.only: SOURCES[args.only]} if args.only else SOURCES

    print(f"\n=== Comparaison sources contacts — {len(cases)} cas × {len(sources)} source(s) ===")
    print(f"Clés : Pappers={'✓' if PAPPERS_KEY else '✗'}  "
          f"Dropcontact={'✓' if DROPCONTACT_KEY else '✗'}  "
          f"LinkedIn={'✓' if LINKEDIN_COOKIE else '✗'}\n")

    for case in cases:
        who = f"{case.get('role','?')} @ {case['company']}"
        print(f"── {who} " + "─" * max(0, 44 - len(who)))
        for name, fn in sources.items():
            try:
                out = fn(case)
            except Exception as e:  # noqa: BLE001
                out = {"status": "error", "detail": str(e)}
            print(f"  {name:12} {json.dumps(out, ensure_ascii=False)}")
        print()

    print("Astuce : remplace TEST_CASES par tes vraies cibles (ou branche sur tes prospects Supabase).")


if __name__ == "__main__":
    main()
