"""
Qualité d'une adresse email trouvée pour une société (même règles que lib/email-quality.js).

Écarte :
- les boîtes inadaptées à la prospection (recrutement, RGPD, webmaster, noreply, presse, compta…) ;
- les filiales étrangères (alpha.germany@…, …@xxx.de) pour une société française ;
- les adresses personnelles (gmail, orange…) quand la société a son propre domaine ;
- les adresses d'une autre organisation : domaine différent du site connu et sans
  rapport exact avec le nom de la société.
"""
import re
import unicodedata

WEBMAIL = {
    "gmail.com", "googlemail.com", "hotmail.fr", "hotmail.com", "live.fr", "live.com", "outlook.fr", "outlook.com",
    "msn.com", "yahoo.fr", "yahoo.com", "icloud.com", "me.com", "aol.com", "aol.fr", "gmx.fr", "gmx.com", "orange.fr",
    "wanadoo.fr", "free.fr", "sfr.fr", "neuf.fr", "laposte.net", "bbox.fr", "aliceadsl.fr", "club-internet.fr", "numericable.fr",
    "protonmail.com", "proton.me",
}
REJECT_LOCAL = re.compile(
    r"^(no-?reply|noreply|ne-?pas-?repondre|donotreply|do-not-reply|recrutement|recruitment|recrute|recruit|jobs?|emplois?|"
    r"careers?|carrieres?|candidatures?|candidats?|stages?|alternance|rh|drh|hr|rgpd|dpo|privacy|gdpr|cnil|donnees-?personnelles|"
    r"webmaster|website|web|postmaster|hostmaster|abuse|newsletters?|unsubscribe|desinscription|presse|press|media|medias|"
    r"facturation|factures?|invoices?|billing|compta|comptabilite|accounting|fournisseurs?|suppliers?)$")
WEAK_LOCAL = re.compile(r"^(commercial|commerciale|sales|ventes?|sav|service-?client|serviceclient|customer-?service|commandes?|"
                        r"orders?|shop|boutique|marketing|communication|reservations?|booking)$")
GENERIC_LOCAL = re.compile(r"^(contact|contacts|info|infos|information|accueil|bonjour|hello|hi|mail|email|office|secretariat|"
                           r"direction|admin|administration|standard|reception|siege|agence|general)\b")
FOREIGN_WORDS = {"germany", "deutschland", "gmbh", "espana", "spain", "italia", "italy", "uk", "usa", "nederland", "netherlands",
                 "polska", "poland", "portugal", "benelux", "belgium", "schweiz", "austria", "india", "china", "japan"}
FOREIGN_TLD = (".de", ".it", ".es", ".co.uk", ".uk", ".nl", ".pl", ".pt", ".at", ".cn", ".in", ".jp")
STOP = {"sa", "sas", "sasu", "sarl", "eurl", "sci", "snc", "scop", "sem", "gie", "se", "selarl", "selas", "ste", "societe",
        "et", "de", "du", "des", "la", "le", "les", "l", "d", "and", "the", "groupe", "group", "france", "cie", "compagnie",
        "cabinet", "ets", "etablissements", "holding", "international", "industrie", "industries", "services", "solutions",
        "conseil", "consulting", "en", "sur", "a", "au", "aux"}
EMAIL_OK = re.compile(r"^[^\s@]+@[^\s@]+\.[a-z]{2,}$", re.I)


def _norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def core_tokens(name):
    base = re.sub(r"\(.*?\)", " ", name or "")
    return [t for t in _norm(base).split() if t not in STOP]


def domain_base(host):
    """« www.alpha-motors.co.uk » → « alphamotors » (étiquette enregistrée, sans tirets)."""
    parts = [p for p in str(host or "").lower().removeprefix("www.").split(".") if p]
    if len(parts) < 2:
        return "".join(parts).replace("-", "")
    label = parts[-3] if len(parts) >= 3 and parts[-2] in ("co", "com", "gouv", "asso") else parts[-2]
    return label.replace("-", "")


def expand_names(names):
    """Noms + sigles entre parenthèses : « MONTS INSERTION (MIF CONSEIL) » → [nom, « MIF CONSEIL »]."""
    out = []
    for n in names or []:
        for x in [n, *re.findall(r"\(([^)]+)\)", n or "")]:
            if x and x not in out:
                out.append(x)
    return out


def name_match(base, names):
    """« strong » si le domaine est le nom (ou ses initiales), « weak » s'il le contient, sinon None."""
    best = None
    for name in expand_names(names):
        core = core_tokens(name)
        if not core:
            continue
        compact = "".join(core)
        full = _norm(name).replace(" ", "")
        initials = "".join(t if len(t) <= 3 else t[0] for t in core)
        stripped = re.sub(r"\d+$", "", base)
        if base in (compact, full) or (stripped and stripped == compact) or (len(core) >= 3 and base == initials):
            return "strong"
        if len(compact) >= 4 and base.startswith(compact) and re.fullmatch(r"(fr|france|groupe|group|sa|sas)?", base[len(compact):]):
            return "strong"
        if any(len(t) >= 4 and t in base for t in core) or (len(compact) >= 5 and compact in base):
            best = "weak"
    return best


def assess_email(email, names=(), domains=(), official=False):
    """{"ok", "level" (strong | weak), "reason", "generic", "weak_box"} (pur, testé)."""
    e = str(email or "").strip().lower().strip(".")
    if not EMAIL_OK.match(e):
        return {"ok": False, "reason": "adresse mal formée"}
    local, _, dom = e.partition("@")
    generic = bool(GENERIC_LOCAL.match(local))
    if REJECT_LOCAL.match(local):
        return {"ok": False, "reason": "boîte non adaptée (recrutement, RGPD, webmaster…)"}
    words = set(re.split(r"[._\-+]", local)) | set(re.split(r"[.\-]", dom))
    if words & FOREIGN_WORDS or dom.endswith(FOREIGN_TLD):
        return {"ok": False, "reason": "filiale ou bureau étranger"}
    base = {"generic": generic, "weak_box": bool(WEAK_LOCAL.match(local))}
    if official:
        return {"ok": True, "level": "strong", "reason": "source officielle", **base}
    own = [d for d in (domains or []) if d]
    if dom in WEBMAIL:
        if own:
            return {"ok": False, "reason": "adresse personnelle alors que la société a son propre domaine"}
        compact_local = _norm(local).replace(" ", "")
        if any(len(t) >= 3 and t in compact_local for n in names for t in core_tokens(n)):
            return {"ok": True, "level": "weak", "reason": "messagerie grand public au nom de la société", **base}
        return {"ok": False, "reason": "adresse personnelle sans le nom de la société"}
    b = domain_base(dom)
    if any(domain_base(d) == b for d in own):
        return {"ok": True, "level": "strong", "reason": "domaine du site officiel", **base}
    m = name_match(b, names)
    if own:
        if m == "strong":
            return {"ok": True, "level": "weak", "reason": "domaine au nom de la société, différent du site connu", **base}
        return {"ok": False, "reason": "domaine d'une autre organisation que le site officiel"}
    if m:
        return {"ok": True, "level": m, "reason": "domaine au nom de la société", **base}
    return {"ok": False, "reason": "domaine sans rapport avec la société"}


def email_rank(email, q, votes=1):
    """Clé de tri : forte confiance, nb de sources, boîte informatique, générique, boîte commerciale en dernier."""
    local = email.split("@")[0]
    it = bool(re.match(r"^(dsi|informatique|it|si|support-?it|helpdesk|systeme|systemes|reseau|infra)\b", local))
    return (q.get("level") != "strong", -votes, not it, q.get("weak_box", False), not q.get("generic"))


if __name__ == "__main__":  # auto-test : python email_quality.py
    names = ["ALPHA MOTORS SAS"]
    assert assess_email("contact@alpha-motors.fr", names, ["alpha-motors.fr"])["level"] == "strong"
    assert assess_email("contact@alphamotors.com", names)["level"] == "strong"
    assert not assess_email("recrutement@alpha-motors.fr", names, ["alpha-motors.fr"])["ok"]
    assert not assess_email("alpha.germany@alpha-europe.com", names)["ok"]
    assert not assess_email("contact@alpha.de", names)["ok"]
    assert not assess_email("jean.alpha.59@gmail.com", names, ["alpha-motors.fr"])["ok"]
    assert assess_email("garage.alphamotors@orange.fr", names)["ok"]
    assert not assess_email("jean@gmail.com", names)["ok"]
    assert not assess_email("contact@ecole-azur.fr", ["AZUR VILLE"], ["azurforyou.com"])["ok"]
    assert not assess_email("contact@koralconseil.com", ["KORAL"], ["koral.bike"])["ok"]
    assert assess_email("accueil@orbital.fr", ["ORBITAL GROUP"], ["orbit.com"])["ok"]
    assert assess_email("contact@verneuil.law", ["CABINET VERNEUIL"], ["cabinetverneuil.com"])["ok"]
    assert assess_email("contact@lumio.bzh", ["LUMIO"], ["lumio.fr"])["level"] == "strong"
    assert assess_email("contact@ccvb.eu", ["CC de la Vallée Bleue"])["level"] == "strong"
    assert assess_email("contact@mifconseil.fr", ["MONTS INSERTION FORMATION CONSEIL (MIF CONSEIL)"])["level"] == "strong"
    assert assess_email("ccx71@orange.fr", ["CC X"], ["ccx.fr"], official=True)["ok"]
    assert assess_email("commercial@alpha-motors.fr", names, ["alpha-motors.fr"])["weak_box"]
    print("email_quality : ok")
