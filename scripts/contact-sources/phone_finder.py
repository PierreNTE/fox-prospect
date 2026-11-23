"""
Agent de recherche du standard téléphonique d'une société — 100 % gratuit.

Cherche « "Nom" commune téléphone » dans le SearXNG local et lit uniquement les
titres et extraits des résultats (aucune page d'annuaire n'est ouverte). Un
numéro n'est retenu que si l'extrait cite la société, et s'il revient dans
plusieurs résultats ou à côté de la commune. Les numéros surtaxés de mise en
relation (089x), que les annuaires affichent à la place du vrai numéro, sont
écartés. Résultat écrit sur le compte comme « standard à vérifier ».
"""
import re
import unicodedata

from discover_free import searx_search, company_core, mentions_company

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


def find_standard(company, commune):
    """Renvoie (numéro, nb_sources) — (None, 0) si rien de sûr."""
    core = " ".join(company_core(company))
    if not core:
        return None, 0
    results = []
    queries = [f'"{core}" {commune or ""} téléphone'.strip(), f'"{core}" {commune or ""} contact'.strip()]
    if commune:
        queries.append(f'"{core}" téléphone standard')  # sociétés multi-sites : siège ailleurs
    for q in queries:
        results += searx_search(q, max_results=15)
        number, n = pick_phone(results, company, commune)
        if number:
            return number, n
    return None, 0


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
    print("phone_finder : ok")
