#!/usr/bin/env python3
"""
POC Scrapling — collecteur de signaux "recrutement" depuis les pages carrières.

Objectif : tester si Scrapling surface des offres d'emploi IT/cyber que la
collecte actuelle (France Travail + web_search de Claude) rate — notamment sur
les portails carrières en JavaScript / derrière anti-bot (Workday, etc.).

Tourne EN LOCAL sur ta machine (pas sur Vercel). Fusionne les signaux trouvés
dans accounts.signals (JSONB) — le champ lu par le dashboard « Comptes chauds »,
avec un marqueur origin='scrapling:careers' pour les distinguer des signaux LLM.

Sécurité : aucun secret en dur. Les clés sont lues depuis ../../.env.local
(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — le même fichier que l'app Next.js.

Usage :
    # 1. Installer (une fois)
    python -m venv .venv
    .venv\\Scripts\\activate        # Windows
    pip install -r requirements.txt
    scrapling install               # télécharge les navigateurs

    # 2. Lancer — DRY-RUN par défaut (n'écrit rien, affiche ce qu'il trouverait)
    python collect_careers.py

    # 3. Pour écrire réellement dans Supabase
    python collect_careers.py --commit

Options :
    --commit            écrit les signaux dans Supabase (sinon dry-run)
    --limit N           ne traite que les N premiers comptes (def. 10)
    --account "Nom"     ne traite qu'un compte par son nom (correspondance floue)
    --headful           navigateur visible (debug)
"""

import argparse
import sys
import time
import re
from datetime import date
from pathlib import Path
from urllib.parse import urljoin, urlparse

# ── Chargement de l'environnement (.env.local du projet) ──────────────────────
try:
    from dotenv import load_dotenv
except ImportError:
    sys.exit("Manque python-dotenv. Lance : pip install -r requirements.txt")

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env.local")

import os

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents de .env.local")

try:
    from supabase import create_client
except ImportError:
    sys.exit("Manque supabase. Lance : pip install -r requirements.txt")

try:
    from scrapling.fetchers import StealthyFetcher
except ImportError:
    sys.exit("Manque scrapling. Lance : pip install -r requirements.txt && scrapling install")

# ── Configuration métier ──────────────────────────────────────────────────────

# Mots-clés qui qualifient une offre comme signal IT pertinent (alignés sur
# lib/collect-france-travail.js : HIGH_VALUE_KEYWORDS + variantes).
IT_KEYWORDS = [
    "rssi", "dsi", "ciso", "cyber", "cybersécurité", "cybersecurite", "sécurité",
    "securite", "soc", "siem", "cloud", "devops", "infrastructure", "systèmes",
    "systemes", "réseau", "reseau", "data", "sre", "kubernetes", "azure", "aws",
    "gcp", "architecte si", "ingénieur si", "administrateur système", "pentest",
    "iam", "active directory", "vmware", "datacenter", "infogérance",
]

# Mots-clés "haute valeur" = postes décideurs/sensibles → poids plus fort.
HIGH_VALUE = ["rssi", "dsi", "ciso", "cyber", "soc", "siem", "architecte", "pentest", "iam"]

# Chemins carrières courants à tester (FR + EN).
CAREER_PATHS = [
    "/carrieres", "/carriere", "/nos-offres", "/nous-rejoindre", "/rejoignez-nous",
    "/recrutement", "/emploi", "/emplois", "/offres-emploi", "/jobs", "/careers",
    "/career", "/join-us", "/join", "/work-with-us", "/vacancies", "/opportunities",
]

# Texte d'ancre qui trahit un lien vers les carrières (pour scan de la home).
CAREER_ANCHOR_RE = re.compile(
    r"(carri[èe]re|recrut|nous rejoindre|rejoignez|emploi|job|career|vacanc|talent)",
    re.IGNORECASE,
)

REQUEST_DELAY_S = 2.0   # politesse entre deux comptes
TODAY = date.today().isoformat()


# ── Helpers ───────────────────────────────────────────────────────────────────

def base_url(account):
    """Construit une base http(s) à partir du domain ou website du compte."""
    domain = (account.get("domain") or "").strip()
    website = (account.get("website") or "").strip()
    if website:
        if not website.startswith("http"):
            website = "https://" + website
        return website.rstrip("/")
    if domain:
        return "https://" + domain.lstrip("/").rstrip("/")
    return None


def fetch(url, headless=True):
    """Récupère une page via StealthyFetcher (anti-bot). Renvoie la page ou None."""
    try:
        StealthyFetcher.adaptive = True
        page = StealthyFetcher.fetch(url, headless=headless, timeout=30000)
        status = getattr(page, "status", 200)
        if status and status >= 400:
            return None
        return page
    except Exception as e:  # noqa: BLE001 — POC : on log et on continue
        print(f"      ⚠  fetch échoué ({url}): {e}")
        return None


def anchors(page):
    """Liste de (texte, href) des liens de la page, défensivement."""
    out = []
    try:
        for a in page.css("a"):
            txt = ""
            href = ""
            try:
                txt = (a.css("::text").get() or "").strip()
            except Exception:  # noqa: BLE001
                pass
            try:
                href = a.attrib.get("href", "") if hasattr(a, "attrib") else ""
            except Exception:  # noqa: BLE001
                pass
            if href:
                out.append((txt, href))
    except Exception:  # noqa: BLE001
        pass
    return out


def discover_careers_urls(home, base):
    """Trouve des URLs carrières en scannant les ancres de la home page."""
    found = []
    for txt, href in anchors(home):
        if CAREER_ANCHOR_RE.search(txt) or CAREER_ANCHOR_RE.search(href):
            full = urljoin(base + "/", href)
            # On reste sur le même domaine que la cible.
            if urlparse(full).netloc.endswith(urlparse(base).netloc.split(":")[0]):
                found.append(full)
    return list(dict.fromkeys(found))  # dédup, ordre préservé


def extract_job_titles(page):
    """Extrait des intitulés candidats : ancres + titres h1-h4 + items de liste."""
    titles = []
    for sel in ["a::text", "h1::text", "h2::text", "h3::text", "h4::text", "li::text"]:
        try:
            titles.extend(page.css(sel).getall())
        except Exception:  # noqa: BLE001
            continue
    # Nettoyage : trim, longueur plausible d'un intitulé de poste.
    cleaned = []
    for t in titles:
        t = re.sub(r"\s+", " ", (t or "")).strip()
        if 6 <= len(t) <= 120:
            cleaned.append(t)
    return list(dict.fromkeys(cleaned))


def is_it_job(title):
    low = title.lower()
    return any(kw in low for kw in IT_KEYWORDS)


def weight_for(title):
    low = title.lower()
    return 35 if any(kw in low for kw in HIGH_VALUE) else 20


# ── Pipeline principal ────────────────────────────────────────────────────────

def scan_account(account, args):
    """Renvoie la liste des signaux trouvés pour un compte."""
    name = account["name"]
    base = base_url(account)
    if not base:
        print(f"  • {name} — pas de site web, ignoré")
        return []

    print(f"  • {name} ({base})")
    candidate_urls = [base + p for p in CAREER_PATHS]

    # On scanne d'abord la home pour découvrir le vrai lien carrières.
    home = fetch(base, headless=not args.headful)
    if home:
        discovered = discover_careers_urls(home, base)
        if discovered:
            candidate_urls = discovered + candidate_urls

    seen_titles = set()
    signals = []
    pages_ok = 0

    for url in candidate_urls[:6]:  # plafonne le nombre de pages testées
        page = fetch(url, headless=not args.headful)
        if not page:
            continue
        pages_ok += 1
        for title in extract_job_titles(page):
            if not is_it_job(title):
                continue
            key = title.lower()
            if key in seen_titles:
                continue
            seen_titles.add(key)
            signals.append({
                "type": "recrutement",
                "detail": f"Offre IT : {title}"[:300],
                "date": TODAY,
                "source": url,
                "confidence": 0.8,            # scrapé, non vérifié par un humain
                "base_weight": weight_for(title),
                "origin": "scrapling:careers",  # marqueur pour distinguer des signaux LLM
            })
        if signals:
            break  # une page carrières exploitable suffit pour le POC

    print(f"      {pages_ok} page(s) lue(s) · {len(signals)} signal(s) IT")
    for s in signals[:12]:
        print(f"        – {s['detail']}")
    return signals


def main():
    ap = argparse.ArgumentParser(description="POC Scrapling — signaux recrutement carrières")
    ap.add_argument("--commit", action="store_true", help="écrit dans Supabase (sinon dry-run)")
    ap.add_argument("--limit", type=int, default=10, help="nombre max de comptes")
    ap.add_argument("--account", type=str, default=None, help="cible un compte par nom")
    ap.add_argument("--headful", action="store_true", help="navigateur visible (debug)")
    args = ap.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Cible : les comptes suivis ayant un site web. Les signaux scrapés sont
    # fusionnés dans accounts.signals (JSONB), lu directement par le dashboard
    # « Comptes chauds » — pas besoin de company_id / SIRENE.
    q = sb.table("accounts").select("id, name, website, domain, signals, auto_watch").eq("auto_watch", True)
    if args.account:
        q = q.ilike("name", f"%{args.account}%")
    res = q.execute()
    accounts = [a for a in (res.data or []) if (a.get("website") or a.get("domain"))][: args.limit]

    mode = "COMMIT" if args.commit else "DRY-RUN"
    print(f"\n=== POC Scrapling carrières — {mode} ===")
    print(f"{len(accounts)} compte(s) avec site web à scanner\n")

    if not accounts:
        print("Aucun compte avec site web. Renseigne le champ 'website' de tes")
        print("comptes (page Comptes) pour activer le scraping des pages carrières.")
        return

    total_found = 0
    total_inserted = 0
    total_skipped = 0

    for account in accounts:
        signals = scan_account(account, args)
        total_found += len(signals)

        # Fusion dans accounts.signals : on dédoublonne par 'detail' contre
        # les signaux déjà présents (LLM ou scrapés), puis on ajoute les nouveaux.
        if args.commit and signals:
            existing = account.get("signals") or []
            existing_details = {s.get("detail") for s in existing if isinstance(s, dict)}
            fresh = [s for s in signals if s["detail"] not in existing_details]
            total_skipped += len(signals) - len(fresh)
            if fresh:
                merged = existing + fresh
                try:
                    sb.table("accounts").update({"signals": merged}).eq("id", account["id"]).execute()
                    total_inserted += len(fresh)
                    print(f"      ✓ {len(fresh)} signal(s) fusionné(s) dans le compte")
                except Exception as e:  # noqa: BLE001
                    print(f"      ⚠  mise à jour échouée : {e}")
                    total_skipped += len(fresh)

        time.sleep(REQUEST_DELAY_S)

    print("\n" + "─" * 50)
    print(f"Signaux IT trouvés   : {total_found}")
    if args.commit:
        print(f"Ajoutés aux comptes  : {total_inserted}")
        print(f"Ignorés (doublons)   : {total_skipped}")
    else:
        print("(DRY-RUN — rien écrit. Relance avec --commit pour fusionner.)")
    print("─" * 50)
    print("\nCompare ensuite ces signaux à ceux de France Travail / web_search :")
    print("→ page Comptes : les signaux scrapés remontent dans la chaleur.\n")


if __name__ == "__main__":
    main()
