#!/usr/bin/env python3
"""
Découverte de décideurs IT — 100% GRATUIT, tout Scrapling, zéro clé API.

Chaîne :
  1. DÉCOUVRIR : Scrapling scrape DuckDuckGo (html) pour
     `site:linkedin.com/in "Société" (DSI OR RSSI ...)` → URLs de profils.
  2. EXTRAIRE  : Scrapling charge chaque profil public → nom, poste, société, lieu
     (via les balises meta — validé, sans login).

Aucune clé, aucun crédit. Lecture seule. Tourne en local.

Usage :
    python discover_free.py
    python discover_free.py --case 0
    python discover_free.py --no-extract     # juste les URLs trouvées (plus rapide)
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

try:
    from scrapling.fetchers import StealthyFetcher
except ImportError:
    sys.exit("Manque scrapling. Réutilise le venv ..\\scrapling-careers\\.venv")

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env.local")
except ImportError:
    pass

StealthyFetcher.adaptive = True

# Proxy résidentiel optionnel (env SCRAPE_PROXY) — franchit le blocage des IP
# datacenter (GitHub Actions, VPS). Format : http://user:pass@host:port
PROXY = os.environ.get("SCRAPE_PROXY") or None
# Clé API Brave Search (gratuite, 2000 req/mois) : découverte fiable des URLs
# LinkedIn sans scraper DuckDuckGo (qui bloque même via proxy). Si absente,
# repli sur le scraping DDG (fragile depuis une IP datacenter/proxy).
BRAVE_KEY = os.environ.get("BRAVE_API_KEY") or None


def _sfetch(url, timeout=30000):
    """Fetch Scrapling avec proxy résidentiel si SCRAPE_PROXY est défini."""
    kw = {"headless": True, "timeout": timeout}
    if PROXY:
        kw["proxy"] = PROXY
    return StealthyFetcher.fetch(url, **kw)


def load_targets_from_db(limit):
    """Charge les noms de comptes depuis Supabase (table accounts), via REST."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents de .env.local")
    req = urllib.request.Request(
        f"{url}/rest/v1/accounts?select=name&order=name",
        headers={"apikey": key, "Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=20) as r:
        rows = json.loads(r.read().decode())
    return [{"company": row["name"]} for row in rows[:limit]]


TARGETS = [
    {"company": "Decathlon"},
    {"company": "Groupama"},
    {"company": "Accor"},
]

# Une requête SIMPLE par libellé de poste (DDG html ne gère pas OR/parenthèses).
# Libellés précis : "DSI" seul est trop bruité, on cible des intitulés explicites.
# Liste courte volontairement : DDG et LinkedIn throttlent vite le scraping rapide.
ROLE_QUERIES = [
    '"Directeur des Systèmes d\'Information"',
    "CISO",
    '"Directeur Cybersécurité"',
]

# Cadence : scraping non authentifié = rate limits. On espace pour rester sous le radar.
DDG_DELAY_S = 4.0       # entre deux requêtes DuckDuckGo
EXTRACT_DELAY_S = 3.0   # entre deux fetchs de profil LinkedIn


def ddg_links(query):
    """Scrape DuckDuckGo HTML (région FR). Renvoie (urls LinkedIn, blocked: bool)."""
    # kl=fr-fr : résultats France — sinon DDG remonte des profils étrangers non pertinents.
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query, "kl": "fr-fr"})
    try:
        p = _sfetch(url, timeout=30000)
    except Exception as e:  # noqa: BLE001
        print(f"      ⚠  DDG fetch échoué : {str(e)[:120]}")
        return [], True
    # Détection de la page anti-bot ("Unfortunately, bots use DuckDuckGo too.").
    try:
        body = " ".join(p.css("body ::text").getall()).lower()
    except Exception:  # noqa: BLE001
        body = ""
    blocked = ("bots use duckduckgo" in body) or ("anomaly" in body)
    hrefs = []
    for sel in ["a.result__a::attr(href)", "a.result__url::attr(href)", "a::attr(href)"]:
        try:
            hrefs.extend(p.css(sel).getall())
        except Exception:  # noqa: BLE001
            continue
    out = []
    for h in hrefs:
        if not h:
            continue
        # DDG enveloppe les liens : //duckduckgo.com/l/?uddg=<url encodée>&...
        m = re.search(r"[?&]uddg=([^&]+)", h)
        real = urllib.parse.unquote(m.group(1)) if m else h
        if "linkedin.com/in/" in real:
            out.append(real.split("?")[0])
    # dédup en gardant l'ordre
    return list(dict.fromkeys(out)), blocked


import unicodedata

_LEGAL = {"SA", "SAS", "SASU", "SARL", "EURL", "SCI", "SNC", "SCOP", "SEM", "GIE", "SE", "SELARL", "SELAS",
          "STE", "SOCIETE", "ET", "DE", "DU", "DES", "LA", "LE", "LES", "L", "D", "AND", "THE", "GROUPE",
          "GROUP", "FRANCE", "CIE", "COMPAGNIE"}


def _norm(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn").upper()
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def company_core(company):
    """Mots distinctifs du nom (sans formes juridiques ni parenthèses)."""
    base = re.sub(r"\(.*?\)", " ", company or "")
    return [t for t in _norm(base).split() if t not in _LEGAL and len(t) >= 2]


def mentions_company(text, company):
    """Le texte (titre + extrait du résultat) cite-t-il vraiment la société ?"""
    core = company_core(company)
    if not core:
        return False
    words = set(_norm(text).split())
    compact = _norm(text).replace(" ", "")
    if all(t in words for t in core):
        return True
    joined = "".join(core)
    return len(joined) >= 5 and joined in compact


def brave_contacts(query, company, must_match=False):
    """Recherche Brave → contacts {company, name, headline, linkedin_url, source}
    lus DIRECTEMENT dans les snippets (titre + description), SANS fetch LinkedIn.
    Le titre LinkedIn est de la forme "Prénom Nom - Poste - Société | LinkedIn".
    Renvoie (contacts, blocked)."""
    if not BRAVE_KEY:
        return [], 1
    url = "https://api.search.brave.com/res/v1/web/search?" + urllib.parse.urlencode(
        {"q": query, "count": 20, "country": "fr"})
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001
        print(f"      ⚠  Brave API échouée : {str(e)[:120]}")
        return [], 1
    results = ((data.get("web") or {}).get("results")) or []
    out = []
    for res in results:
        link = res.get("url", "")
        if "linkedin.com/in/" not in link:
            continue
        title = re.sub(r"\s*[-–|]\s*LinkedIn\s*$", "", (res.get("title") or "")).strip()
        parts = re.split(r"\s[-–|]\s", title)
        name = parts[0].strip()
        role = parts[1].strip() if len(parts) > 1 else (res.get("description") or "")[:120].strip()
        # Filtre les résultats qui ne sont pas un vrai profil (page login/générique).
        if not name or re.search(r"linkedin|s.identifier|s.inscrire|sign\s?up|join now|milliard|million", name, re.I):
            continue
        # Leads : on ne garde que les profils dont le résultat cite la société
        # (sinon Brave renvoie les DSI d'autres entreprises).
        if must_match and not mentions_company(f"{res.get('title') or ''} {res.get('description') or ''}", company):
            continue
        out.append({
            "company": company,
            "name": name,
            "headline": role,
            "linkedin_url": link.split("?")[0],
            "source": "brave:linkedin-snippet",
        })
    return out, 0


def _extract_once(url):
    """Une tentative d'extraction d'un profil LinkedIn public."""
    try:
        p = _sfetch(url, timeout=30000)
    except Exception as e:  # noqa: BLE001
        return {"linkedin_url": url, "error": str(e)[:100]}

    def meta(attr, val):
        try:
            return (p.css(f'meta[{attr}="{val}"]::attr(content)').get() or "").strip()
        except Exception:
            return ""

    desc = meta("name", "description") or meta("property", "og:description")
    ogtitle = meta("property", "og:title")
    name = re.split(r"\s[-–]\s", ogtitle)[0].replace("| LinkedIn", "").strip() if ogtitle else ""

    # Mur d'authentification LinkedIn : la page renvoie "Sign Up"/générique au lieu
    # du profil. On le détecte et on traite comme un échec (compté en blocked).
    WALL = {"sign up", "join linkedin", "linkedin", "s'inscrire", "inscrivez-vous", ""}
    dlow = desc.lower()
    if name.strip().lower() in WALL or "million+ members" in dlow or "millions de membres" in dlow:
        return {"linkedin_url": url, "error": "mur d'authentification LinkedIn"}

    def field(label):
        m = re.search(label + r"\s*:\s*([^·]+)", desc)
        return m.group(1).strip() if m else ""

    return {
        "name": name,
        "headline": desc.split(" · ")[0][:100] if desc else "",
        "entreprise": field("Expérience"),
        "lieu": field("Lieu"),
        "linkedin_url": url,
    }


def extract_profile(url, retries=2):
    """Extrait un profil LinkedIn ; réessaie sur mur d'auth. Le proxy rotatif tire
    une nouvelle IP à chaque tentative → augmente nettement le taux de succès.
    (Coût : jusqu'à 3 fetchs sur un profil récalcitrant — Go proxy en plus.)"""
    last = {"linkedin_url": url, "error": "non tenté"}
    for attempt in range(retries + 1):
        last = _extract_once(url)
        if not last.get("error"):
            return last
        if attempt < retries:
            time.sleep(2)
    return last


def discover_company(company, roles=None, max_profiles=4, extract=True,
                     ddg_delay=DDG_DELAY_S, extract_delay=EXTRACT_DELAY_S, log=print,
                     must_match=False, quiet=False):
    """Découvre des décideurs IT pour une société (importable par le worker).

    Renvoie (contacts, blocked) :
      - contacts : list de dicts {company, name, headline, entreprise, lieu, linkedin_url}
                   (ou {company, linkedin_url} si extract=False)
      - blocked  : nb de sources bloquées/en échec (pour stats.blocked du job)
    Ne lève jamais : en cas de blocage, renvoie ce qui a été collecté.
    """
    roles = roles or ROLE_QUERIES

    # ── Voie fiable : données lues dans les snippets Brave, SANS fetch LinkedIn ──
    # Évite le mur d'auth LinkedIn (qui bloque même via proxy) et ne consomme quasi
    # pas de proxy. Nom + poste + URL viennent du titre/description du résultat Brave.
    if BRAVE_KEY:
        seen, contacts, blocked = set(), [], 0
        name_q = f'"{" ".join(company_core(company))}"' if must_match else company
        for rq in roles:
            q = f'{name_q} {rq} site:linkedin.com/in'
            rows, blk = brave_contacts(q, company, must_match=must_match)
            blocked += blk
            for c in rows:
                if c["linkedin_url"] in seen:
                    continue
                seen.add(c["linkedin_url"])
                contacts.append(c)
            time.sleep(1.2)  # Brave free tier : ~1 req/s
        contacts = contacts[:max_profiles]
        if not quiet:  # journaux publics : jamais de noms de personnes en mode worker
            for c in contacts:
                log(f"      • {c['name']} — {c['headline']}")
        log(f"   {len(contacts)} contact(s) via Brave")
        return contacts, blocked

    # ── Repli : scraping DDG + fetch profil (fragile, via proxy) ────────────────
    all_urls, blocked = [], 0
    name_q = f'"{" ".join(company_core(company))}"' if must_match else company
    for rq in roles:
        q = f'{name_q} {rq} site:linkedin.com/in'
        links, is_blocked = ddg_links(q)
        if is_blocked:
            blocked += 1
        all_urls.extend(links)
        time.sleep(ddg_delay)
    urls = list(dict.fromkeys(all_urls))
    if not extract:
        return [{"company": company, "linkedin_url": u} for u in urls[:max_profiles]], blocked
    contacts = []
    for u in urls[:max_profiles]:
        prof = extract_profile(u)
        if prof.get("error"):
            blocked += 1
        elif must_match and not mentions_company(" ".join(str(v) for v in prof.values()), company):
            continue  # profil d'une autre société
        else:
            contacts.append({"company": company, **prof})
        time.sleep(extract_delay)
    return contacts, blocked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", type=int)
    ap.add_argument("--from-db", type=int, metavar="N", help="charge N comptes depuis Supabase")
    ap.add_argument("--no-extract", action="store_true", help="seulement les URLs")
    ap.add_argument("--max", type=int, default=4, help="profils extraits par cible")
    ap.add_argument("--save", action="store_true", help="écrit les contacts en JSON + CSV")
    args = ap.parse_args()

    if args.from_db is not None:
        cases = load_targets_from_db(args.from_db)
    elif args.case is not None:
        cases = [TARGETS[args.case]]
    else:
        cases = TARGETS

    print(f"\n=== Découverte 100% gratuite (Scrapling + DuckDuckGo) — {len(cases)} cible(s) ===\n")

    collected = []  # contacts pour la sauvegarde

    for t in cases:
        print(f"── {t['company']}")
        contacts, blocked = discover_company(
            t["company"], max_profiles=args.max, extract=not args.no_extract)
        collected.extend(contacts)
        if blocked:
            print(f"   ⚠  {blocked} source(s) bloquée(s)/en échec")
        print()

    if args.save and collected:
        stamp = datetime.now().strftime("%Y%m%d-%H%M")
        base = Path(__file__).resolve().parent / f"contacts_{stamp}"
        with open(f"{base}.json", "w", encoding="utf-8") as f:
            json.dump(collected, f, ensure_ascii=False, indent=2)
        cols = ["company", "name", "headline", "entreprise", "lieu", "linkedin_url"]
        with open(f"{base}.csv", "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(collected)
        print(f"✓ {len(collected)} contact(s) sauvegardé(s) → {base}.json / .csv")


if __name__ == "__main__":
    main()
