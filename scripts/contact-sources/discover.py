#!/usr/bin/env python3
"""
Découverte de décideurs IT — comparaison de deux voies.

Voie A — web_search Claude : on demande au modèle « qui est le DSI de X ? »
         avec recherche web. (ANTHROPIC_API_KEY + crédits)
Voie B — API de recherche Brave : requête site:linkedin.com/in → URLs de profils,
         puis nom/poste depuis le titre. (BRAVE_API_KEY — free tier 2000/mois)

But : sur les mêmes cibles (rôle @ société), voir quelle voie trouve les bons
décideurs, avec quelle couverture. Lecture seule. Lit ../../.env.local.

Usage :
    python discover.py
    python discover.py --only brave
    python discover.py --case 0
"""

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    sys.exit("Manque python-dotenv. Réutilise le venv ..\\scrapling-careers\\.venv")

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env.local")

ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY")
BRAVE_KEY = os.environ.get("BRAVE_API_KEY")
MODEL = os.environ.get("MODEL_SONNET", "claude-sonnet-4-6")
SB_URL = os.environ.get("SUPABASE_URL")
SB_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Tarifs en euros par million de jetons — alignés sur ANTHROPIC_TARIF
# (lib/constants.js), TARIF_LLM (veille/config.py) et TARIF (scripts/eval.mjs).
# À corriger AUX QUATRE endroits si les tarifs changent.
#
# Haiku a porté 0,25 / 1,25 jusqu'au 2026-07-27 : le tarif de Haiku 3.5, pas
# celui de haiku-4-5, facturé quatre fois plus cher.
TARIF = {
    "haiku": {"entree": 0.93, "sortie": 4.65},
    "sonnet": {"entree": 2.8, "sortie": 14.0},
    "recherche_par_k": 9.3,
}

# Cibles : rôle décideur + société. Remplace par tes vrais comptes.
TARGETS = [
    {"role": "DSI", "company": "Decathlon"},
    {"role": "RSSI", "company": "Groupama"},
    {"role": "Directeur des Systèmes d'Information", "company": "SNCF"},
]


def http(method, url, headers=None, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:300]}
    except Exception as e:  # noqa: BLE001
        return 0, {"error": str(e)}


# ── Comptabilité ──────────────────────────────────────────────────────────────

def journaliser_ai_run(usage, recherches=0, modele=MODEL):
    """Inscrit la dépense dans ai_runs, comme n'importe quel appel de l'app.

    Ce script tape l'API Anthropic en direct et tombe sur la MÊME facture que
    l'application. Tant qu'il ne journalisait rien, sa dépense était invisible
    au kill-switch de lib/budget.js. Rapproché le 2026-07-27 : la console
    facturait 15,20 $ quand ai_runs n'en voyait que 9,88 € — un garde-fou
    budgétaire ne protège que ce qu'il voit.

    Au mieux et jamais bloquant : une comparaison de sources ne doit pas
    échouer parce que la base est injoignable.
    """
    if not (SB_URL and SB_KEY and usage):
        return
    tarif = TARIF["haiku"] if "haiku" in str(modele) else TARIF["sonnet"]
    cout = ((usage.get("input_tokens", 0) / 1e6) * tarif["entree"]
            + (usage.get("output_tokens", 0) / 1e6) * tarif["sortie"]
            + (recherches / 1000) * TARIF["recherche_par_k"])
    try:
        http("POST", f"{SB_URL}/rest/v1/ai_runs",
             headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                      "content-type": "application/json", "Prefer": "return=minimal"},
             body=[{
                 "route": "discover",
                 "input_tokens": usage.get("input_tokens", 0),
                 "output_tokens": usage.get("output_tokens", 0),
                 "web_search_count": recherches,
                 "cost_eur": round(cout, 5),
             }])
    except Exception:  # noqa: BLE001
        pass  # la comptabilité ne prime jamais sur la mesure


# ── Voie A : web_search Claude ────────────────────────────────────────────────

def discover_websearch(target):
    if not ANTHROPIC_KEY:
        return {"status": "skipped", "reason": "ANTHROPIC_API_KEY absente (ou crédits à zéro)"}
    system = ("Tu identifies le décideur IT actuel d'une entreprise française à partir de "
              "sources publiques. Tu réponds UNIQUEMENT en JSON valide, sans markdown.")
    user = (f'Qui occupe actuellement le poste de "{target["role"]}" (ou équivalent) chez '
            f'{target["company"]} ? Utilise la recherche web. Format : '
            '{"candidates":[{"name":"prénom nom","role":"intitulé exact","linkedin_url":"si trouvée","source_url":"url"}]}')
    body = {
        "model": MODEL, "max_tokens": 1200, "system": system,
        "messages": [{"role": "user", "content": user}],
        "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3,
                   "user_location": {"type": "approximate", "country": "FR"}}],
    }
    code, data = http("POST", "https://api.anthropic.com/v1/messages",
                      headers={"content-type": "application/json", "x-api-key": ANTHROPIC_KEY,
                               "anthropic-version": "2023-06-01"}, body=body)
    if code != 200:
        return {"status": "error", "code": code, "detail": (data.get("error") or data)}
    content = data.get("content", [])
    text = "\n".join(b.get("text", "") for b in content if b.get("type") == "text")
    searches = (data.get("usage", {}).get("server_tool_use", {}) or {}).get("web_search_requests", 0)
    journaliser_ai_run(data.get("usage") or {}, searches, MODEL)
    try:
        m = re.search(r"\{[\s\S]*\}", text)
        parsed = json.loads(m.group(0)) if m else {}
    except Exception:  # noqa: BLE001
        parsed = {}
    return {"status": "ok", "candidates": parsed.get("candidates", []), "searches": searches}


# ── Voie B : API de recherche Brave → profils LinkedIn ────────────────────────

def discover_brave(target):
    if not BRAVE_KEY:
        return {"status": "skipped", "reason": "BRAVE_API_KEY absente (free tier sur brave.com/search/api)"}
    q = f'site:linkedin.com/in "{target["company"]}" ({target["role"]} OR DSI OR RSSI OR "IT Director")'
    url = "https://api.search.brave.com/res/v1/web/search?" + urllib.parse.urlencode({"q": q, "count": 10})
    code, data = http("GET", url, headers={"Accept": "application/json", "X-Subscription-Token": BRAVE_KEY})
    if code != 200:
        return {"status": "error", "code": code, "detail": (data.get("error") or data)}
    results = ((data.get("web") or {}).get("results")) or []
    candidates = []
    for r in results:
        link = r.get("url", "")
        if "linkedin.com/in/" not in link:
            continue
        title = r.get("title", "")
        # Titre LinkedIn type "Prénom Nom - Intitulé - Société | LinkedIn"
        parts = re.split(r"\s[-–|]\s", title)
        name = parts[0].strip()
        role = parts[1].strip() if len(parts) > 1 else ""
        candidates.append({"name": name, "role": role, "linkedin_url": link.split("?")[0]})
    return {"status": "ok", "candidates": candidates[:6]}


SOURCES = {"websearch": discover_websearch, "brave": discover_brave}


def main():
    ap = argparse.ArgumentParser(description="Découverte de décideurs — comparaison 2 voies")
    ap.add_argument("--only", choices=list(SOURCES))
    ap.add_argument("--case", type=int)
    args = ap.parse_args()

    cases = [TARGETS[args.case]] if args.case is not None else TARGETS
    sources = {args.only: SOURCES[args.only]} if args.only else SOURCES

    print(f"\n=== Découverte décideurs — {len(cases)} cible(s) × {len(sources)} voie(s) ===")
    print(f"Clés : Anthropic={'✓' if ANTHROPIC_KEY else '✗'}  Brave={'✓' if BRAVE_KEY else '✗'}\n")

    for t in cases:
        print(f"── {t['role']} @ {t['company']} " + "─" * 10)
        for name, fn in sources.items():
            try:
                out = fn(t)
            except Exception as e:  # noqa: BLE001
                out = {"status": "error", "detail": str(e)[:160]}
            if out.get("status") == "ok":
                cands = out.get("candidates", [])
                extra = f" ({out['searches']} rech.)" if "searches" in out else ""
                print(f"  {name:11}{extra}: {len(cands)} candidat(s)")
                for c in cands[:4]:
                    print(f"      • {c.get('name','?')} — {c.get('role','')} {c.get('linkedin_url','')}")
            else:
                print(f"  {name:11}: {out.get('status')} — {out.get('reason') or out.get('detail','')}")
        print()


if __name__ == "__main__":
    main()
