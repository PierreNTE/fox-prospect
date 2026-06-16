#!/usr/bin/env python3
"""
Waterfall d'enrichissement EMAIL — 100% gratuit, multi-sources, façon FullEnrich.

Principe : pour un contact (prénom, nom, domaine société), on interroge plusieurs
sources GRATUITES en cascade, puis on recoupe pour sortir le meilleur email avec
un niveau de confiance basé sur l'accord entre sources.

Sources (toutes gratuites) :
  A. Motif déduit + check MX (DNS over HTTPS, sans dépendance)
  B. Scraping du site société (contact / mentions légales) → emails réels → motif
  C. Scraping moteur de recherche (email exposé publiquement)
  D. (option --smtp) vérif SMTP RCPT TO — peu fiable, risque IP, OFF par défaut

Recoupement : un candidat trouvé par plusieurs sources monte en confiance.
Le TÉLÉPHONE direct n'est pas couvert : pas de source fiable gratuite (c'est
précisément ce que vendent Kaspr/Lusha). Switchboard société = via le site.

Lecture seule (sauf --smtp qui ouvre des connexions SMTP). Tourne en local.

Usage :
    python waterfall.py --first Thierry --last Douceron --domain decathlon.fr
    python waterfall.py --first X --last Y --domain z.fr --no-search   # sans moteur
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from unicodedata import normalize, combining

try:
    from scrapling.fetchers import StealthyFetcher
    StealthyFetcher.adaptive = True
except ImportError:
    StealthyFetcher = None

# Proxy résidentiel optionnel (env SCRAPE_PROXY) — voir discover_free.py.
PROXY = os.environ.get("SCRAPE_PROXY") or None


def _sfetch(url, timeout=25000):
    kw = {"headless": True, "timeout": timeout}
    if PROXY:
        kw["proxy"] = PROXY
    return StealthyFetcher.fetch(url, **kw)

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def deburr(s):
    """é→e, ç→c… pour générer des emails ASCII."""
    return "".join(c for c in normalize("NFKD", s) if not combining(c)).lower().strip()


# ── Source A : motifs + check MX ──────────────────────────────────────────────

def _clean(s):
    """Nettoie un prénom/nom pour un email : sans accent, sans espace ni ponctuation."""
    return re.sub(r"[^a-z0-9]", "", deburr(s))


def gen_patterns(first, last, domain):
    f, l = _clean(first), _clean(last)
    fi, li = (f[:1] or ""), (l[:1] or "")
    locals_ = [
        f"{f}.{l}", f"{f}{l}", f"{fi}{l}", f"{f}{li}", f"{f}_{l}",
        f"{f}-{l}", f"{l}.{f}", f"{f}", f"{l}", f"{fi}.{l}",
    ]
    return [f"{x}@{domain}" for x in dict.fromkeys(locals_) if x]


def mx_ok(domain):
    """Le domaine reçoit-il du mail ? Via DNS-over-HTTPS Google (aucune dépendance)."""
    try:
        url = "https://dns.google/resolve?" + urllib.parse.urlencode({"name": domain, "type": "MX"})
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.loads(r.read().decode())
        return any(a.get("type") == 15 for a in data.get("Answer", []))
    except Exception:  # noqa: BLE001
        return None


# ── Source B : scraping du site société → emails réels → motif ────────────────

CONTACT_PATHS = ["", "/contact", "/nous-contacter", "/mentions-legales",
                 "/mentions-legales/", "/legal", "/presse", "/contactez-nous"]


def site_emails(domain):
    if not StealthyFetcher:
        return []
    base = f"https://{domain}"
    found = set()
    for path in CONTACT_PATHS[:5]:
        try:
            p = _sfetch(base + path, timeout=20000)
            text = " ".join(p.css("body ::text").getall())
            for m in EMAIL_RE.findall(text):
                if m.lower().endswith("@" + domain):
                    found.add(m.lower())
        except Exception:  # noqa: BLE001
            continue
        if found:
            break
        time.sleep(2)
    return sorted(found)


def infer_pattern_from(emails, domain):
    """Déduit un motif (prenom.nom, p.nom…) depuis des emails réels du domaine."""
    patterns = set()
    for e in emails:
        local = e.split("@")[0]
        if "." in local:
            patterns.add("{first}.{last}" if len(local.split(".")[0]) > 2 else "{f}.{last}")
        elif re.match(r"^[a-z]{2,}$", local):
            patterns.add("{first}")
    return patterns


# ── Source C : scraping moteur (email exposé publiquement) ────────────────────

def search_emails(first, last, domain):
    if not StealthyFetcher:
        return []
    q = f'"{first} {last}" "@{domain}"'
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": q, "kl": "fr-fr"})
    try:
        p = _sfetch(url, timeout=25000)
        text = " ".join(p.css("body ::text").getall())
    except Exception:  # noqa: BLE001
        return []
    return sorted({m.lower() for m in EMAIL_RE.findall(text) if m.lower().endswith("@" + domain)})


# ── Source D : vérif SMTP (option, risquée) ───────────────────────────────────

def smtp_verify(email, domain):
    import smtplib
    try:
        url = "https://dns.google/resolve?" + urllib.parse.urlencode({"name": domain, "type": "MX"})
        with urllib.request.urlopen(url, timeout=15) as r:
            ans = json.loads(r.read().decode()).get("Answer", [])
        mxs = [a["data"].split()[-1].rstrip(".") for a in ans if a.get("type") == 15]
        if not mxs:
            return None
        srv = smtplib.SMTP(timeout=12)
        srv.connect(mxs[0])
        srv.helo("example.com")
        srv.mail("verify@example.com")
        code, _ = srv.rcpt(email)
        srv.quit()
        return code in (250, 251)
    except Exception:  # noqa: BLE001
        return None


# ── Consolidation ─────────────────────────────────────────────────────────────

def _score(srcs):
    """Score 0-100 d'un email selon ses sources. public/site-direct = très fort."""
    s = 0
    s += 60 if ("public" in srcs or "site-direct" in srcs) else 0
    s += 25 if "site-motif" in srcs else 0
    s += 10 if "motif" in srcs else 0
    s += 8 * (len(srcs) - 1)  # bonus multi-sources
    return min(100, s)


def _confidence(score):
    return "haute" if score >= 60 else "moyenne" if score >= 25 else "basse"


def enrich_email(first, last, domain, do_search=True, do_smtp=False):
    """Cascade d'enrichissement email gratuite multi-sources (importable par le worker).

    Renvoie un dict :
      { mx: bool|None,
        best: { email, score, confidence, sources } | None,
        candidates: [ { email, score, sources, smtp? }, ... ]  (triés desc),
        blocked: int }
    Ne lève jamais.
    """
    mx = mx_ok(domain)
    candidates = {}  # email -> set(sources)
    for c in gen_patterns(first, last, domain):
        candidates.setdefault(c, set()).add("motif")

    real = site_emails(domain)
    for pat in infer_pattern_from(real, domain):
        local = (pat.replace("{first}", deburr(first)).replace("{last}", deburr(last))
                    .replace("{f}", deburr(first)[:1]))
        candidates.setdefault(f"{local}@{domain}", set()).add("site-motif")
    for e in real:
        candidates.setdefault(e, set()).add("site-direct")

    if do_search:
        for e in search_emails(first, last, domain):
            candidates.setdefault(e, set()).add("public")

    ranked = sorted(candidates.items(), key=lambda kv: _score(kv[1]), reverse=True)
    out = []
    for email, srcs in ranked:
        item = {"email": email, "score": _score(srcs), "sources": sorted(srcs)}
        if do_smtp:
            item["smtp"] = smtp_verify(email, domain)
        out.append(item)

    best = None
    if out:
        b = out[0]
        best = {**b, "confidence": _confidence(b["score"])}
    return {"mx": mx, "best": best, "candidates": out, "blocked": 0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--first", required=True)
    ap.add_argument("--last", required=True)
    ap.add_argument("--domain", required=True)
    ap.add_argument("--no-search", action="store_true")
    ap.add_argument("--smtp", action="store_true", help="vérif SMTP (risque IP, peu fiable)")
    args = ap.parse_args()

    print(f"\n=== Waterfall email gratuit — {args.first} {args.last} @ {args.domain} ===\n")
    res = enrich_email(args.first, args.last, args.domain,
                       do_search=not args.no_search, do_smtp=args.smtp)
    print(f"A. MX du domaine : {'✓ reçoit du mail' if res['mx'] else '✗/inconnu'}")

    print("\n── Candidats recoupés (meilleur en haut) ──")
    for c in res["candidates"][:6]:
        line = f"  {c['score']:3d}  {c['email']:40s} [{', '.join(c['sources'])}]"
        if "smtp" in c:
            line += f"  SMTP:{'OK' if c['smtp'] else 'KO/inconnu'}"
        print(line)
    if res["best"]:
        print(f"\nMeilleur : {res['best']['email']} (confiance {res['best']['confidence']})")

    print("\nNote : sans --smtp, la confiance vient de l'accord entre sources, pas d'une")
    print("vérif de boîte. Le téléphone direct n'est pas couvert (pas de source gratuite).")


if __name__ == "__main__":
    main()
