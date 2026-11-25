"""
Agent de recherche du standard téléphonique d'une société — 100 % gratuit.

Cherche « "Nom" commune téléphone » dans le SearXNG local et lit uniquement les
titres et extraits des résultats (aucune page d'annuaire n'est ouverte). Un
numéro n'est retenu que si l'extrait cite la société, et s'il revient dans
plusieurs résultats ou à côté de la commune. Les numéros surtaxés de mise en
relation (089x), que les annuaires affichent à la place du vrai numéro, sont
écartés. Résultat écrit sur le compte comme « standard à vérifier ».
"""
import json
import re
import unicodedata
import urllib.parse
import urllib.request

from functools import lru_cache

from discover_free import searx_search, company_core, mentions_company
from email_quality import assess_email, email_rank

# Annuaire de l'administration (service-public.fr, open data, sans clé) :
# standard, email et site officiels des mairies, collectivités, hôpitaux,
# établissements publics. Source la plus sûre pour les acheteurs publics.
ANNUAIRE = "https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records"

PHONE_RE = re.compile(r"(?<![\d+])(?:\+33[\s.\-]?(?:\(0\)[\s.\-]?)?|0)[1-9](?:[\s.\-]?\d{2}){4}(?!\d)")


def _norm(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


def normalize_phone(raw):
    """« +33 (0)2 41-12.34.56 » → « 02 41 12 34 56 » ; None si invalide ou surtaxé."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("33") and len(digits) in (11, 12):
        digits = "0" + digits[2:].lstrip("0") if len(digits) == 12 else "0" + digits[2:]
    if len(digits) != 10 or not re.match(r"0[1-9]", digits):
        return None
    if digits.startswith("089") or digits.startswith("0836"):  # mise en relation surtaxée
        return None
    return " ".join(digits[i:i + 2] for i in range(0, 10, 2))


def pick_phone(results, company, commune=""):
    """Numéro le plus fiable des résultats (pur, testé). Renvoie (numéro, nb_sources) ou (None, 0)."""
    votes, near_city = {}, set()
    city = _norm(commune).strip()
    for res in results:
        text = f"{res.get('title') or ''} {res.get('content') or ''}"
        if not mentions_company(text, company):
            continue
        nums = {n for n in (normalize_phone(m.group(0)) for m in PHONE_RE.finditer(text)) if n}
        for n in nums:
            votes[n] = votes.get(n, 0) + 1
            if city and city in _norm(text):
                near_city.add(n)
    if not votes:
        return None, 0
    # Fixe avant portable, puis le plus cité, puis celui vu près de la commune.
    ranked = sorted(votes, key=lambda n: (n[:2] in ("06", "07"), -votes[n], n not in near_city))
    best = ranked[0]
    # Un fixe cité à côté du nom suffit (marqué « 1 source, à vérifier ») ; un
    # portable seul, sans la commune, peut être celui de n'importe qui : écarté.
    if votes[best] >= 2 or best in near_city or not city or best[:2] not in ("06", "07"):
        return best, votes[best]
    return None, 0


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
FREE_MAIL = {"orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "laposte.net", "gmail.com", "hotmail.fr", "hotmail.com",
             "outlook.fr", "outlook.com", "yahoo.fr", "yahoo.com", "neuf.fr", "bbox.fr", "aliceadsl.fr", "icloud.com", "live.fr"}
# Domaines d'annuaires et de plateformes : leurs adresses ne sont jamais celles de la société.
NOT_COMPANY = ("pagesjaunes", "societe.com", "pappers", "infogreffe", "verif.com", "manageo", "kompass", "linkedin",
               "facebook", "google", "example", "sentry", "wixpress", "annuaire", "118", "mappy", "yelp", "indeed")


def _tokens(company):
    return [t for t in (_norm(x) for x in company_core(company)) if len(t) >= 3]


def email_fits(email, company, names=None, domains=None):
    """L'adresse appartient-elle plausiblement à la société ? (pur, testé — règles dans email_quality.py)"""
    e = (email or "").lower().strip(".")
    _, _, domain = e.partition("@")
    if not domain or any(x in domain for x in NOT_COMPANY):
        return False
    return assess_email(e, names or [company], domains or [])["ok"]


def _best(votes, quality):
    if not votes:
        return None, 0
    best = sorted(votes, key=lambda e: email_rank(e, quality[e], votes[e]))[0]
    return best, votes[best]


def pick_email(results, company, names=None, domains=None):
    """Meilleur email de la société dans les extraits (pur, testé). (email, nb) ou (None, 0)."""
    names = [n for n in (names or [company]) if n]
    votes, quality = {}, {}
    for res in results:
        text = f"{res.get('title') or ''} {res.get('content') or ''}"
        if not mentions_company(text, company):
            continue
        for m in {x.lower().strip(".") for x in EMAIL_RE.findall(text)}:
            if any(x in m.partition("@")[2] for x in NOT_COMPANY):
                continue
            q = assess_email(m, names, domains or [])
            if q["ok"]:
                votes[m] = votes.get(m, 0) + 1
                quality[m] = q
    return _best(votes, quality)


@lru_cache(maxsize=256)
def _annuaire_records_cached(siren):
    return tuple(_annuaire_records_raw(siren))


def _annuaire_records(siren):
    return list(_annuaire_records_cached(str(siren or "")))


def _annuaire_records_raw(siren):
    """Fiches de l'annuaire dont le SIRET commence par le SIREN (plusieurs syntaxes tentées)."""
    if not re.fullmatch(r"\d{9}", str(siren or "")):
        return []
    for where in (f'startswith(siret, "{siren}")', f'siret like "{siren}*"', f'"{siren}"'):
        url = ANNUAIRE + "?" + urllib.parse.urlencode({"where": where, "limit": 5})
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=15) as r:
                data = json.loads(r.read().decode("utf-8"))
            recs = data.get("results") or []
            recs = [x for x in recs if str(x.get("siret") or "").startswith(str(siren))]
            if recs:
                return recs
        except Exception:
            continue
    return []


def annuaire_public(siren):
    """(téléphone, email, site) officiels d'un organisme public, ou (None, None, None)."""
    for rec in _annuaire_records(siren):
        blob = json.dumps(rec, ensure_ascii=False)
        phones = [n for n in (normalize_phone(m.group(0)) for m in PHONE_RE.finditer(blob)) if n]
        emails = [e.lower() for e in EMAIL_RE.findall(blob) if not e.lower().endswith("service-public.fr")]
        emails = [e for e in emails if assess_email(e, official=True)["ok"]]  # pas de rgpd@, webmaster@…
        sites = re.findall(r"https?://[^\s\"\\,]+", str(rec.get("site_internet") or ""))
        if phones or emails:
            fixe = [p for p in phones if p[:2] not in ("06", "07")]
            return (fixe or phones or [None])[0], (emails or [None])[0], (sites or [None])[0]
    return None, None, None


def _variants(company, alt=None):
    """Noms à chercher : raison sociale SIRENE, puis le nom Salesforce s'il diffère."""
    out = []
    for name in (company, alt):
        core = " ".join(company_core(name or ""))
        if core and core not in out:
            out.append(core)
    return out


def find_email(company, commune, siren=None, alt=None, public=False, domain=None):
    """Renvoie (email, nb_sources, téléphone_vu, source) — email None si rien de sûr."""
    if public and siren:
        phone, email, _ = annuaire_public(siren)
        if email:
            return email, 3, phone, "annuaire service-public"
    names = _variants(company, alt)
    if not names:
        return None, 0, None, None
    queries = []
    if domain:
        # Adresses publiées sur le domaine de la société (pages, PDF, annuaires).
        queries += [f'"@{domain}"', f'site:{domain} contact', f'site:{domain} mentions légales']
    for core in names:
        queries += [f'"{core}" {commune or ""} email contact'.strip(), f'"{core}" {commune or ""} "@"'.strip(), f'"{core}" "contact@"']
    if siren:
        queries.append(f'"{siren}" email')
    all_names = [n for n in (company, alt) if n]
    results = []
    for q in queries[:8]:
        results += searx_search(q, max_results=15)
        email, n = (pick_email(results, company, all_names) if not domain
                    else _pick_on_domain(results, company, domain, all_names))
        if not email and alt and not domain:
            email, n = pick_email(results, alt, all_names)
        if email:
            phone, _ = pick_phone(results, company, commune)
            return email, n, phone, "recherche web"
    return None, 0, None, None


def _pick_on_domain(results, company, domain, names=None):
    """Avec un domaine connu : toute adresse de ce domaine compte, même si l'extrait ne cite pas la société.
    Une adresse d'un autre domaine n'est gardée que si ce domaine porte exactement le nom de la société."""
    names = [n for n in (names or [company]) if n]
    votes, quality = {}, {}
    for res in results:
        text = f"{res.get('title') or ''} {res.get('content') or ''}"
        for m in {x.lower().strip(".") for x in EMAIL_RE.findall(text)}:
            if not (m.endswith("@" + domain) or mentions_company(text, company)):
                continue
            if any(x in m.partition("@")[2] for x in NOT_COMPANY):
                continue
            q = assess_email(m, names, [domain])
            if q["ok"]:
                votes[m] = votes.get(m, 0) + 1
                quality[m] = q
    return _best(votes, quality)


def find_standard(company, commune, siren=None, alt=None, public=False, etab_commune=None):
    """Renvoie (numéro, nb_sources, source) — (None, 0, None) si rien de sûr."""
    if public and siren:
        phone, _, _ = annuaire_public(siren)
        if phone:
            return phone, 3, "annuaire service-public"
    names = _variants(company, alt)
    if not names:
        return None, 0, None
    queries = []
    for core in names:
        queries += [f'"{core}" {commune or ""} téléphone'.strip(), f'"{core}" {commune or ""} contact'.strip()]
        if etab_commune and etab_commune != commune:
            queries.append(f'"{core}" {etab_commune} téléphone')  # établissement appelé, siège ailleurs
        if commune:
            queries.append(f'"{core}" téléphone standard')  # sociétés multi-sites
    if siren:
        spaced = f"{siren[:3]} {siren[3:6]} {siren[6:]}"
        queries += [f'"{siren}" téléphone', f'"{spaced}" téléphone']
    results = []
    for q in queries[:8]:
        results += searx_search(q, max_results=15)
        number, n = pick_phone(results, company, commune or etab_commune or "")
        if not number and alt:
            number, n = pick_phone(results, alt, commune or etab_commune or "")
        if number:
            return number, n, "recherche web"
    return None, 0, None


if __name__ == "__main__":  # auto-test : python phone_finder.py
    assert normalize_phone("+33 (0)2 41-12.34.56") == "02 41 12 34 56"
    assert normalize_phone("0892 12 34 56") is None
    assert normalize_phone("01 23 45") is None
    fake = [
        {"title": "Garage Alpha Motors - Angers", "content": "Garage Alpha Motors à Angers. Tél : 02 41 00 00 01 · Mise en relation 0892 00 00 00"},
        {"title": "Alpha Motors", "content": "Contactez Alpha Motors au 02.41.00.00.01"},
        {"title": "Autre société", "content": "Beta SARL 02 99 99 99 99"},
    ]
    assert pick_phone(fake, "ALPHA MOTORS SAS", "Angers") == ("02 41 00 00 01", 2)
    assert pick_phone(fake[2:], "ALPHA MOTORS SAS", "Angers") == (None, 0)
    lone = [{"title": "Alpha Motors", "content": "Alpha Motors 06 12 34 56 78"}]
    assert pick_phone(lone, "ALPHA MOTORS SAS", "Angers") == (None, 0)
    fixed = [{"title": "Alpha Motors", "content": "Alpha Motors, tél. 02 41 00 00 02"}]
    assert pick_phone(fixed, "ALPHA MOTORS SAS", "Angers") == ("02 41 00 00 02", 1)
    assert email_fits("contact@alpha-motors.fr", "ALPHA MOTORS SAS")
    assert email_fits("garage.alpha@orange.fr", "ALPHA MOTORS SAS")
    assert not email_fits("contact@pagesjaunes.fr", "ALPHA MOTORS SAS")
    assert not email_fits("jean@gmail.com", "ALPHA MOTORS SAS")
    mails = [
        {"title": "Alpha Motors Angers", "content": "Écrivez à contact@alpha-motors.fr ou info@pagesjaunes.fr"},
        {"title": "Alpha Motors", "content": "Alpha Motors — contact@alpha-motors.fr — 02 41 00 00 01"},
    ]
    assert pick_email(mails, "ALPHA MOTORS SAS") == ("contact@alpha-motors.fr", 2)
    bad = [{"title": "Alpha Motors", "content": "Alpha Motors recrute : recrutement@alpha-motors.fr, contact@alpha-motors.fr"},
           {"title": "Alpha Motors", "content": "Alpha Motors recrutement@alpha-motors.fr"}]
    assert pick_email(bad, "ALPHA MOTORS SAS") == ("contact@alpha-motors.fr", 1)
    other = [{"title": "Alpha Motors", "content": "Alpha Motors, partenaire : contact@ecole-beta.fr"}]
    assert _pick_on_domain(other, "ALPHA MOTORS SAS", "alpha-motors.fr") == (None, 0)
    dom = [{"title": "Annuaire", "content": "Écrire à j.martin@alpha-motors.fr ou contact@alpha-motors.fr"},
           {"title": "PDF", "content": "contact@alpha-motors.fr"}]
    assert _pick_on_domain(dom, "ALPHA MOTORS SAS", "alpha-motors.fr") == ("contact@alpha-motors.fr", 2)
    assert _variants("ALPHA MOTORS SAS", "ALPHA MOTORS SAS") == _variants("ALPHA MOTORS SAS")
    print("phone_finder : ok")
