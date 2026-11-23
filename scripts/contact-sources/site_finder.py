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

from discover_free import searx_search, company_core, mentions_company

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


LEGAL_LINK = re.compile(r'href=["\']([^"\'#]+)["\'][^>]*>([^<]{0,80})', re.I)
LEGAL_WORDS = re.compile(r"mention|l[ée]gal|legal|cgv|cgu|conditions|confidentialit|a-propos|qui-sommes|contact|imprint", re.I)


def _title(html):
    m = re.search(r"<title[^>]*>(.*?)</title>", html or "", re.I | re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def verify_site(url, siren, company=""):
    """Renvoie (statut, raison) : 'verifie' si une page cite le SIREN ; 'probable'
    si le domaine EST le nom distinctif (≥ 5 caractères) et que le titre le cite ;
    sinon (None, raison)."""
    host = host_of(url)
    base = f"https://{host}"
    try:
        home = _get(base + "/")
    except Exception as e:  # noqa: BLE001
        return None, f"inaccessible ({str(e)[:40]})"
    if not home:
        return None, "page vide"
    if has_siren(home, siren):
        return "verifie", "SIREN sur l'accueil"
    # Liens légaux réellement présents sur l'accueil, puis chemins usuels.
    links = []
    for href, label in LEGAL_LINK.findall(home):
        if LEGAL_WORDS.search(href + " " + label):
            full = urllib.parse.urljoin(base + "/", href)
            if host_of(full) == host and full not in links:
                links.append(full)
    for path in ("/mentions-legales", "/mentions-legales/", "/mentions-legales.html", "/informations-legales", "/legal", "/legal-notice", "/cgv"):
        if base + path not in links:
            links.append(base + path)
    for u in links[:8]:
        try:
            if has_siren(_get(u), siren):
                return "verifie", "SIREN dans les pages légales"
        except Exception:  # noqa: BLE001
            continue
    core = "".join(company_core(company)).lower()
    label = re.sub(r"[^a-z0-9]", "", host.rsplit(".", 1)[0])
    if len(core) >= 5 and label == core and mentions_company(_title(home), company):
        return "probable", "domaine = nom et titre concordant"
    return None, "SIREN absent"


def find_official_site(company, commune, siren, log=print):
    """Renvoie (url, statut, essais) — url None si rien de retenu.
    essais = [(hôte, raison)] (stocké en base pour diagnostic, jamais journalisé)."""
    core = " ".join(company_core(company))
    if not core:
        return None, None, []
    queries = [f'"{core}" {commune or ""}'.strip(), f'"{core}" site officiel', f'"{core}" mentions légales {siren}']
    seen = []
    for q in queries:
        for res in searx_search(q, max_results=12):
            h = host_of(res.get("url", ""))
            if not h or DIRECTORIES.search(h) or h in seen:
                continue
            seen.append(h)
    trials, fallback = [], None
    for h in seen[:6]:
        status, why = verify_site(h, siren, company)
        trials.append((h, why))
        if status == "verifie":
            return f"https://{h}/", "verifie", trials
        if status == "probable" and not fallback:
            fallback = h
    if fallback:
        return f"https://{fallback}/", "probable", trials
    return None, None, trials
