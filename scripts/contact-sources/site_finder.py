"""
Agent de recherche du site officiel d'une société — 100 % gratuit.

1. Cherche « "Nom" commune » et « "Nom" site officiel » dans le SearXNG local
   (lancé par le workflow), sans clé ni coût.
2. Écarte annuaires et réseaux sociaux.
3. Visite chaque candidat (accueil + mentions légales) et ne retient que le site
   dont les pages citent le SIREN de la société : aucune devinette.
Le site trouvé est écrit sur le compte ; la collecte web de l'appli (Vercel)
reprend ensuite tout le reste (standard, emails, outils, DNS…).
"""
import re
import urllib.parse
import urllib.request

from discover_free import searx_search, company_core

UA = "Mozilla/5.0 (compatible; FoxProspect/1.0; recherche du site officiel)"

DIRECTORIES = re.compile(
    r"(^|\.)(societe\.com|pappers\.fr|verif\.com|infogreffe\.fr|annuaire-entreprises\.data\.gouv\.fr|data\.gouv\.fr|"
    r"pagesjaunes\.fr|linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|wikipedia\.org|"
    r"manageo\.fr|corporama\.com|societeinfo\.com|kompass\.com|bodacc\.fr|indeed\.com|welcometothejungle\.com|"
    r"google\.[a-z.]+|mappy\.com|118712\.fr|annuaire\.[a-z]+|lefigaro\.fr|entreprises\.lefigaro\.fr|"
    r"infonet\.fr|score3\.fr|dun\.?bradstreet|dnb\.com|lagazettefrance\.fr|bfmtv\.com|ouest-france\.fr|"
    r"francetravail\.fr|pole-emploi\.fr|hellowork\.com|glassdoor\.[a-z]+|trustpilot\.com|tripadvisor\.[a-z]+|"
    r"opencorporates\.com|northdata\.[a-z]+|firmenwissen\.[a-z]+|infobel\.com|cylex\.[a-z.]+|hoodspot\.fr|"
    r"wikimonde\.com|doctrine\.fr|legalstart\.fr|bilansgratuits\.fr|creditsafe\.com|ellisphere\.com)$", re.I)


def host_of(url):
    try:
        return urllib.parse.urlparse(url).hostname.lower().removeprefix("www.")
    except Exception:  # noqa: BLE001
        return ""


def _get(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html", "Accept-Language": "fr-FR"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if "html" not in (r.headers.get("Content-Type") or "text/html"):
            return ""
        return r.read(1_500_000).decode("utf-8", errors="replace")


def has_siren(text, siren):
    if not siren or not re.fullmatch(r"\d{9}", siren):
        return False
    pat = rf"{siren[:3]}[\s. ]?{siren[3:6]}[\s. ]?{siren[6:]}"
    return re.search(pat, text or "") is not None


def verify_site(url, siren):
    """True si l'accueil ou les mentions légales citent le SIREN."""
    base = f"https://{host_of(url)}"
    for path in ("/", "/mentions-legales", "/mentions-legales/", "/mentions_legales", "/legal", "/contact"):
        try:
            if has_siren(_get(base + path), siren):
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


def find_official_site(company, commune, siren, log=print):
    """Renvoie (url, candidats_testés) — url None si rien de vérifié."""
    core = " ".join(company_core(company))
    if not core:
        return None, 0
    queries = [f'"{core}" {commune or ""}'.strip(), f'"{core}" site officiel', f'"{core}" mentions légales {siren}']
    seen, tested = [], 0
    for q in queries:
        for res in searx_search(q, max_results=12):
            h = host_of(res.get("url", ""))
            if not h or DIRECTORIES.search(h) or h in seen:
                continue
            seen.append(h)
    for h in seen[:6]:
        tested += 1
        if verify_site(h, siren):
            return f"https://{h}/", tested
    return None, tested
