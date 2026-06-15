# Acquisition de contacts — boîte à outils

Outils locaux (lecture seule) pour **trouver des prospects décideurs IT et leurs
coordonnées**, façon FullEnrich, en privilégiant le **100% gratuit par scraping**.

Tout tourne en local (hors Vercel), réutilise le venv de Scrapling, et lit le même
`../../.env.local` que l'app.

---

## 1. Le pipeline en 3 étages

```
   DÉCOUVRIR              EXTRAIRE                ENRICHIR
   le bon décideur   →    ses infos LinkedIn  →   email / téléphone
   (nom, société)        (poste, société)        (coordonnées)
```

| Étage | Gratuit par scraping ? | Constat empirique (cette session) |
|---|---|---|
| **Découvrir** (nom + poste + URL LinkedIn) | ✅ **oui, prouvé** | Decathlon → Thierry Douceron (DSI), Edoardo Rossi (CISO)… |
| **Extraire** (profil → poste/société/lieu) | ✅ **oui, prouvé** | meta LinkedIn lisibles sans login |
| **Enrichir email — PME** (site expose l'email) | 🟡 souvent | scraping pages contact/mentions légales |
| **Enrichir email — grand compte** (site cache) | ❌ devinettes | 6 candidats `motif`, aucune certitude |
| **Téléphone direct / mobile** | ❌ non | pas de source gratuite fiable |

**Pourquoi FullEnrich est payant** : ses fournisseurs ont des bases de boîtes mail
et de téléphones **pré-collectées et vérifiées**, plus des fermes de proxies. Le
scraping gratuit reproduit la *structure* (cascade multi-sources) mais pas la
*couverture*. La **découverte** (le plus cher dans les outils payants) est, elle,
gratuite et fiable ici.

---

## 2. Installation

Réutilise le venv déjà installé pour Scrapling (`../scrapling-careers/.venv`).
Si absent :

```powershell
cd ..\scrapling-careers
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\scrapling.exe install      # navigateurs
```

Toutes les commandes ci-dessous s'exécutent depuis `scripts\contact-sources\` avec
`..\scrapling-careers\.venv\Scripts\python.exe`.

---

## 3. Les scripts

### `discover_free.py` — découverte 100% gratuite ⭐

Le cœur de l'approche gratuite. Scrape **DuckDuckGo** (sans clé) pour
`site:linkedin.com/in "Société" <poste>`, récupère les URLs de profils, puis
**extrait** nom / poste / société / lieu depuis les balises meta du profil public
(sans login, sans risque de bannissement).

```powershell
# Sur une cible de test en dur (--case 0 = Decathlon)
..\scrapling-careers\.venv\Scripts\python.exe discover_free.py --case 0

# Sur tes vrais comptes Supabase (table accounts), avec export
..\scrapling-careers\.venv\Scripts\python.exe discover_free.py --from-db 5 --save

# Juste les URLs (plus rapide, pas d'extraction)
..\scrapling-careers\.venv\Scripts\python.exe discover_free.py --case 0 --no-extract
```

| Option | Effet |
|---|---|
| `--from-db N` | charge N comptes depuis Supabase (`accounts.name`) |
| `--case N` | une cible de test en dur (`TARGETS`) |
| `--max N` | nb de profils extraits par société (déf. 4) |
| `--no-extract` | s'arrête aux URLs trouvées |
| `--save` | écrit `contacts_<horodatage>.json` + `.csv` |

**Réglages clés dans le fichier** : `ROLE_QUERIES` (libellés de poste ciblés —
« DSI » seul est trop bruité), `kl=fr-fr` (résultats France), `DDG_DELAY_S` /
`EXTRACT_DELAY_S` (cadence anti-blocage).

> ⚠️ **Rate limit** : DuckDuckGo bloque l'IP sous volume (« Unfortunately, bots use
> DuckDuckGo too »). Outil à **débit lent** : quelques sociétés par session,
> espacées. Le blocage est temporaire (quelques heures). Voir §5.

### `waterfall.py` — enrichissement email gratuit multi-sources

Pour un contact connu (prénom, nom, domaine), cascade de sources **gratuites** puis
recoupement, façon FullEnrich :

- **A.** Motifs (`prenom.nom@…`) + check MX (DNS-over-HTTPS, sans dépendance)
- **B.** Scraping du site société (contact / mentions légales) → emails réels → motif
- **C.** Scraping moteur (`"Prénom Nom" "@domaine"` → email exposé publiquement)
- **D.** *(option `--smtp`)* vérif SMTP RCPT TO — peu fiable, risque IP, **OFF par défaut**

```powershell
..\scrapling-careers\.venv\Scripts\python.exe waterfall.py --first Thierry --last Douceron --domain decathlon.fr
..\scrapling-careers\.venv\Scripts\python.exe waterfall.py --first X --last Y --domain z.fr --no-search
```

| Option | Effet |
|---|---|
| `--first` / `--last` / `--domain` | **requis** : le contact à enrichir |
| `--no-search` | saute le scraping moteur (si DDG bloqué) |
| `--smtp` | active la vérif SMTP (risque IP, souvent non concluant sur M365/Gmail) |

**Constat honnête** : sur un grand compte qui cache ses emails, on n'obtient que des
motifs devinés (plusieurs candidats à confiance faible). La confiance vient de
l'**accord entre sources** : un email trouvé sur le site OU exposé publiquement
monte fort ; un simple motif reste incertain. Le **téléphone direct n'est pas
couvert** (pas de source gratuite).

### `discover.py` — comparaison de voies de découverte *(clés requises)*

Compare deux voies de découverte payantes/à clé sur les mêmes cibles :

- **web_search** (Claude) — `ANTHROPIC_API_KEY` (+ crédits). Réutilise la logique
  d'analyse de compte de l'app.
- **brave** — `BRAVE_API_KEY` (free tier 2000/mois). `site:linkedin.com/in` → URLs.

```powershell
..\scrapling-careers\.venv\Scripts\python.exe discover.py
..\scrapling-careers\.venv\Scripts\python.exe discover.py --only brave --case 0
```

Adaptateurs défensifs : clé absente → `skipped`. Sert à mesurer si une voie payante
fait mieux que le gratuit (`discover_free.py`).

### `compare.py` — comparaison de sources d'enrichissement *(clés requises)*

Sur un même contact, compare ce que renvoie chaque source :

- **pappers** — société + **dirigeants légaux** (pas le DSI) — `PAPPERS_API_KEY`
- **dropcontact** — email vérifié — `DROPCONTACT_API_KEY`
- **linkedin** — extraction du profil public (gratuit, via `linkedin_url`)

```powershell
..\scrapling-careers\.venv\Scripts\python.exe compare.py
..\scrapling-careers\.venv\Scripts\python.exe compare.py --only pappers --case 0
```

---

## 4. Variables d'environnement (`../../.env.local`)

Aucune n'est requise pour le **100% gratuit** (`discover_free.py` + `waterfall.py`),
sauf `--from-db` qui lit Supabase. Les autres ne servent qu'aux scripts à clé.

| Variable | Utilisée par | Coût |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `discover_free.py --from-db` | — (déjà dans l'app) |
| `ANTHROPIC_API_KEY` | `discover.py` (web_search) | usage |
| `BRAVE_API_KEY` | `discover.py` (brave) | gratuit (2000/mois) |
| `PAPPERS_API_KEY` | `compare.py` (pappers) | free tier |
| `DROPCONTACT_API_KEY` | `compare.py` (dropcontact) | payant |

---

## 5. Modèle d'usage réaliste (lire avant de lancer en volume)

Le scraping non authentifié (DDG, LinkedIn) **bloque l'IP sous charge**. Ce n'est pas
un bug : c'est la barrière que les outils payants franchissent avec des proxies.

- ✅ **Bon usage** : quelques sociétés par session, espacées dans la journée. Colle au
  métier (un portefeuille de comptes travaillé sur la durée).
- ❌ **Mauvais usage** : les 59 comptes d'un coup, runs répétés en rafale → blocage IP
  (temporaire, ~quelques heures).
- 🔧 **Pour pousser le volume gratuitement** : rotation multi-moteurs (DDG → Bing →
  Mojeek → Startpage) — non encore implémentée, à demander.
- 💳 **Pour du vrai volume** : proxies payants ou provider (Kaspr/Apollo…).

Fichiers de sortie `contacts_*.json` / `.csv` : **gitignorés** (données personnelles).

---

## 6. RGPD (B2B France) — l'essentiel

Prospecter en B2B est légal au titre de l'**intérêt légitime**, à condition que la
personne puisse s'opposer (l'app gère déjà l'opt-out via la table `optout`). Garde la
**source** de chaque donnée. Note : le scraping LinkedIn reste contraire à ses CGU,
même déconnecté — l'extraction logged-out limite le risque technique (pas de
bannissement de compte) mais pas le risque juridique. À utiliser en connaissance de
cause, sur de la donnée professionnelle uniquement.
