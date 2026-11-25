"""
Trouve un nom de destinataire pour une société qui n'en a pas encore — 100 % gratuit.

Ordre :
1. organisme public : responsable inscrit dans l'annuaire service-public
   (informatique / numérique, puis DGS, puis président ou maire) ;
2. société présidée par une holding : dirigeant (personne) de la holding,
   API Recherche d'entreprises (données RNE publiques) ;
3. recherche web (SearXNG local) : « Prénom Nom, gérant / président / DSI de … »
   lu dans les titres et extraits qui citent la société.
Renvoie {"first", "last", "role", "source"} ou None. Les noms ne sont jamais
écrits dans les journaux publics du worker.
"""
import json
import re
import unicodedata
import urllib.parse
import urllib.request

from discover_free import searx_search, company_core, mentions_company

RE_API = "https://recherche-entreprises.api.gouv.fr/search"

ROLE_PRIORITY = [
    (re.compile(r"informati|num[ée]rique|\bdsi\b|syst[eè]mes? d.information|digital", re.I), 0),
    (re.compile(r"directeur g[ée]n[ée]ral des services|directrice g[ée]n[ée]rale des services|\bdgs\b|secr[ée]taire g[ée]n[ée]ral", re.I), 1),
    (re.compile(r"pr[ée]sident|maire|g[ée]rant|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|\bpdg\b|dirigeant", re.I), 2),
    (re.compile(r"directeur|directrice|responsable", re.I), 3),
]

NOT_A_NAME = {
    "mentions", "legales", "légales", "contact", "accueil", "societe", "société", "groupe", "directeur", "directrice",
    "president", "président", "présidente", "france", "paris", "lyon", "general", "général", "services", "service",
    "association", "commune", "communauté", "communaute", "mairie", "conseil", "monsieur", "madame", "voir", "plus",
    "notre", "votre", "équipe", "equipe", "page", "site", "linkedin", "facebook", "annuaire", "entreprise", "sas", "sarl",
    # Formes et mots de société : un président « personne morale » n'est pas une personne.
    "ste", "sté", "ets", "sci", "sa", "sasu", "eurl", "snc", "selarl", "holding", "holdings", "group", "cie", "compagnie",
    "invest", "investissement", "investissements", "finance", "financiere", "financière", "gestion", "capital", "partners",
    "participations", "consulting", "industrie", "industries", "technologies", "solutions", "international", "europe",
    "développement", "developpement", "immobilier", "patrimoine",
}

_W = r"[A-ZÉÈÊÀÂÎÔÛÇ][a-zéèêëàâîïôûüç]+"
_LAST = r"[A-ZÉÈÊÀÂÎÔÛÇ][A-Za-zÉÈÊÀÂÎÔÛÇéèêëàâîïôûüç'\-]+"
_ROLE = (r"pr[ée]sident(?:e)?(?:[- ]directeur g[ée]n[ée]ral)?|g[ée]rant(?:e)?|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|"
         r"pdg|ceo|fondat(?:eur|rice)|co-?fondat(?:eur|rice)|dirigeant(?:e)?|dsi|directeur des syst[eè]mes d.information|"
         r"responsable informatique|directeur informatique|directeur g[ée]n[ée]ral des services|maire")
_CIV = r"(?:M\.|Mme|Mr|Monsieur|Madame)\s+"
# « Jean Dupont, gérant de … » / « Jean DUPONT (Président) »
NAME_THEN_ROLE = re.compile(rf"(?:{_CIV})?({_W}(?:-{_W})?)\s+({_LAST}(?:\s+{_LAST})?)\s*[,(–-]\s*(?i:est\s+)?(?i:le |la |l')?(?i:({_ROLE}))\b")
# « Président : Jean Dupont » / « Gérant - M. Jean DUPONT »
ROLE_THEN_NAME = re.compile(rf"\b(?i:({_ROLE}))\s*(?:de\s+[^:–\-,.]{{0,40}})?\s*[:–-]\s*(?:{_CIV})?({_W}(?:-{_W})?)\s+({_LAST})")


def _clean(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _title(s):
    return "-".join(p[:1].upper() + p[1:].lower() for p in s.split("-"))


def _valid_name(first, last, company):
    words = [w.lower() for w in f"{first} {last}".replace("-", " ").split()]
    if any(w in NOT_A_NAME for w in words) or len(first) < 2 or len(last) < 2:
        return False
    core = {t.lower() for t in company_core(company)}  # company_core renvoie des majuscules sans accents
    plain = [unicodedata.normalize("NFD", w).encode("ascii", "ignore").decode() for w in words]
    return not any(w in core for w in plain)


def _role_rank(role):
    for rx, rank in ROLE_PRIORITY:
        if rx.search(role or ""):
            return rank
    return 9


def annuaire_person(records):
    """Responsable d'un organisme public dans les fiches de l'annuaire (pur, testé)."""
    people = []

    def walk(x, fonction=""):
        if isinstance(x, str) and x.strip().startswith(("[", "{")):
            try:
                x = json.loads(x)
            except ValueError:
                return
        if isinstance(x, list):
            for y in x:
                walk(y, fonction)
        elif isinstance(x, dict):
            f = _clean(x.get("fonction") or x.get("titre") or fonction)
            p = x.get("personne") if isinstance(x.get("personne"), dict) else x
            nom, prenom = _clean(p.get("nom")), _clean(p.get("prenom"))
            if nom and prenom:
                people.append({"first": _title(prenom), "last": _title(nom), "role": f or "Responsable"})
            for k, v in x.items():
                if k != "personne" and isinstance(v, (list, dict, str)):
                    walk(v, f)

    for rec in records or []:
        walk(rec.get("affectation_personne"))
    people.sort(key=lambda p: _role_rank(p["role"]))
    return people[0] if people else None


def holding_leader(siren, fetch=None):
    """Dirigeant (personne) de la holding qui préside la société. API publique, sans clé."""
    if not re.fullmatch(r"\d{9}", str(siren or "")):
        return None
    try:
        if fetch:
            data = fetch(siren)
        else:
            url = RE_API + "?" + urllib.parse.urlencode({"q": siren, "page": 1, "per_page": 1})
            with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=15) as r:
                data = json.loads(r.read().decode("utf-8"))
        res = (data.get("results") or [None])[0]
        if not res or str(res.get("siren")) != str(siren):
            return None
        for d in res.get("dirigeants") or []:
            if d.get("type_dirigeant") == "personne morale" or re.search(r"commissaire", d.get("qualite") or "", re.I):
                continue
            prenom = _clean(d.get("prenoms")).split(" ")[0]
            nom = _clean(d.get("nom"))
            if prenom and nom:
                role = _clean(d.get("qualite")) or "Dirigeant"
                return {"first": _title(prenom), "last": _title(nom), "role": f"{role} de {res.get('nom_complet') or 'la holding'}"}
    except Exception:
        return None
    return None


def pick_person(results, company):
    """Nom le plus cité avec un rôle de décideur dans les extraits qui citent la société (pur, testé)."""
    votes = {}
    for res in results:
        text = _clean(f"{res.get('title') or ''} — {res.get('content') or ''}")
        if not mentions_company(text, company):
            continue
        found = [(m.group(1), m.group(2), m.group(3)) for m in NAME_THEN_ROLE.finditer(text)]
        found += [(m.group(2), m.group(3), m.group(1)) for m in ROLE_THEN_NAME.finditer(text)]
        for first, last, role in found:
            first, last = _title(first), _title(last.split(" ")[0] if len(last.split(" ")) > 2 else last)
            if not _valid_name(first, last, company):
                continue
            key = (first, last)
            v = votes.setdefault(key, {"n": 0, "role": role})
            v["n"] += 1
            if _role_rank(role) < _role_rank(v["role"]):
                v["role"] = role
    if not votes:
        return None
    (first, last), v = sorted(votes.items(), key=lambda kv: (_role_rank(kv[1]["role"]), -kv[1]["n"]))[0]
    role = v["role"][:1].upper() + v["role"][1:].lower()
    return {"first": first, "last": last, "role": role, "votes": v["n"]}


def find_person(company, commune="", annuaire_records=None, groupe_siren=None, association=False, alt=None, search=searx_search):
    """Renvoie {"first", "last", "role", "source"} ou None."""
    p = annuaire_person(annuaire_records)
    if p:
        return {**p, "source": "annuaire service-public"}
    p = holding_leader(groupe_siren)
    if p:
        return {**p, "source": "dirigeant de la holding (RNE)"}
    for name in [company, alt]:
        core = " ".join(company_core(name or ""))
        if not core:
            continue
        role_words = "président association" if association else "gérant OR président OR dirigeant OR fondateur"
        queries = [f'"{core}" {commune} {role_words}'.strip(), f'"{core}" DSI OR "responsable informatique"',
                   f'"{core}" dirigeant']
        results = []
        for q in queries:
            results += search(q, max_results=15)
            p = pick_person(results, name)
            if p and p["votes"] >= 2:
                break
        p = pick_person(results, name)
        if p:
            return {"first": p["first"], "last": p["last"], "role": p["role"], "source": "recherche web, à vérifier"}
    return None


if __name__ == "__main__":  # auto-test : python person_finder.py
    recs = [{"affectation_personne": json.dumps([
        {"fonction": "Président", "personne": {"prenom": "JEAN", "nom": "MARTIN"}},
        {"fonction": "Directeur général des services", "personne": {"prenom": "Claire", "nom": "Durand"}},
    ])}]
    assert annuaire_person(recs) == {"first": "Claire", "last": "Durand", "role": "Directeur général des services"}
    assert annuaire_person([{}]) is None
    fake = lambda s: {"results": [{"siren": s, "nom_complet": "ALPHA HOLDING", "dirigeants": [
        {"type_dirigeant": "personne morale", "denomination": "X"},
        {"type_dirigeant": "personne physique", "prenoms": "PAUL ANDRE", "nom": "LEROY", "qualite": "Président"}]}]}
    assert holding_leader("123456789", fetch=fake) == {"first": "Paul", "last": "Leroy", "role": "Président de ALPHA HOLDING"}
    res = [
        {"title": "Alpha Motors Angers", "content": "Jean Dupont, gérant de Alpha Motors, nous reçoit."},
        {"title": "Alpha Motors - société", "content": "Dirigeant : M. Jean DUPONT. Alpha Motors, Angers."},
        {"title": "Alpha Motors", "content": "Mentions légales Alpha Motors, Président : Groupe Beta"},
        {"title": "Autre", "content": "Marc Petit, gérant de Gamma"},
    ]
    p = pick_person(res, "ALPHA MOTORS SAS")
    assert (p["first"], p["last"]) == ("Jean", "Dupont") and p["votes"] == 2, p
    assert pick_person(res[3:], "ALPHA MOTORS SAS") is None
    pm = [{"title": "Alpha Motors", "content": "Alpha Motors, Président : Ste Beta Holding. Alpha Motors à Angers."}]
    assert pick_person(pm, "ALPHA MOTORS SAS") is None
    noisy = [{"title": "Alpha Motors", "content": "Alpha Motors : contactez notre équipe, gérant du site. Paul Martin (Président) Alpha Motors"}]
    p = pick_person(noisy, "ALPHA MOTORS SAS")
    assert (p["first"], p["last"], p["role"]) == ("Paul", "Martin", "Président"), p
    print("person_finder : ok")
