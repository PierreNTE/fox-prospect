# Fox Prospect 🦊

Copilote de prospection B2B IT — **qualification, cartographie de comptes,
points d'accroche et pilotage de la prospection**.

Pour chaque prospect (DSI, RSSI, responsable infra…), l'app :
1. cherche sur le web l'actualité de l'entreprise et du contact (signaux d'achat : recrutements IT, levées, projets SI, nominations, NIS2/DORA…),
2. calcule un **score de fit** (0-100) avec justification,
3. propose **3 angles d'accroche** sourcés et datés,
4. génère des **brouillons** : email conforme prospection B2B, message LinkedIn < 280 caractères, points d'ouverture d'appel.

**L'envoi reste 100 % manuel** : tu relis, tu ajustes, tu envoies. C'est le design voulu (protection de ton compte LinkedIn, délivrabilité, qualité).

## Stack

Next.js 14 (App Router, JavaScript) · Supabase (Postgres, RLS) · API Anthropic
(`claude-sonnet-4-6` + `claude-haiku-4-5` + web search) · Vercel (hébergement, free tier).

Coût de fonctionnement **mesuré** sur juillet 2026 (215 qualifications réelles) :
**0,038 € par prospect qualifié**, 0,21 € par analyse de compte, 0,0005 € par
jugement de veille. Vercel et Supabase en free tier. Les appels LLM de l'app
sont journalisés (`ai_runs`) et visibles dans la page **Analyse**, sous un
double plafond mensuel et lissé (voir *Variables d'environnement*).

---

## Installation

### 1. Supabase

1. Crée un projet sur [supabase.com](https://supabase.com) (free tier).
2. Ouvre **SQL Editor** et exécute les migrations **dans l'ordre** (chacune est
   idempotente, `if not exists` partout) :

   | Fichier | Apporte |
   |---|---|
   | `supabase/schema.sql` | base : prospects, research, drafts, settings, optout |
   | `supabase/migration-sprint2.sql` | import LinkedIn, champs enrichissement |
   | `supabase/migration-sprint3.sql` | accounts, account_contacts (organigramme), `prospects.account_id` |
   | `supabase/migration-quickwins.sql` | `ai_runs` (journal des coûts LLM) |
   | `supabase/migration-scraping.sql` | `scrape_jobs`, `scrape_results` (worker GitHub Actions) |
   | `supabase/migration-v1.sql` | companies (SIREN), company_signals (signaux d'achat datés) |
   | `supabase/migration-v2.sql` | `settings.icp`, `prospects.email_confidence/email_source` |
   | `supabase/migration-v3.sql` | `events` (timeline commerciale), `push_subscriptions` |
   | `supabase/migration-v4.sql` … `migration-v6.sql` | statuts simplifiés (P2), interactions (P3), briefs (P4) |
   | `supabase/migration-v7-fiche-compte.sql` | refonte de la fiche compte, organigramme enrichi |
   | `supabase/migration-v8-documents.sql` | documents rattachés (devis, comptes-rendus, contrats) |
   | `supabase/migration-v9-tasks.sql` | agenda / tâches |
   | `supabase/migration-v10-opportunities.sql` | opportunités, pipeline de vente (Jalon 2) |
   | `supabase/migration-v11-ia.sql` | copilote IA (Jalon 3) |
   | `supabase/migration-v12-veille.sql` | module de veille : documents, sources, pgvector `halfvec(1024)` |
   | `supabase/migration-v13-sources-presse.sql` | sources de presse (flux RSS / Atom) |
   | `supabase/migration-v14-flux-par-compte.sql` | flux de veille rattachés à un compte (salles de presse) |
   | `supabase/migration-v15-config-ted.sql` | configuration TED conforme à l'API |
   | `supabase/migration-v16-ia-veille.sql` | étage de jugement IA de la veille |
   | `supabase/migration-v17-sources-muettes.sql` | `last_document_at` — distinguer « a tourné » de « a rapporté » |
   | `supabase/migration-v18-fondations-s1.sql` | index uniques + dédup prospects, cache `company_research`, RPC budget |
   | `supabase/migration-v19-scale-s5.sql` | vue `hot_accounts` (signal < 14 j sans contact < 30 j) |
   | `supabase/migration-v23-dell-cold-calling.sql` | module cold calling Dell : import leads Salesforce, santé société, qualif infra + BANT, préparation d'appel |
   | `supabase/migration-v24-leads-priorite.sql` | suivi hebdo des leads Salesforce : `sf_first_seen_at` / `sf_last_seen_at` (badges « Nouveau » / « Absent ») |
   | `supabase/migration-v27-mode-gratuit.sql` | job `find_website` (recherche du site officiel par le moteur local du worker) |
   | `supabase/migration-v26-collecte-web.sql` | `accounts.web_intel` / `web_intel_at` : collecte web gratuite par compte |
   | `supabase/migration-v25-agent-leads.sql` | jobs `call_prep` (agent hebdo des leads) et `enrich_contact` ajoutés à la contrainte `jobs_kind_check` |

   > `v18` et `v19` portaient les numéros `v7` et `v10` sur une branche restée à
   > part ; ils ont été renumérotés au rebasage du 26 juillet 2026, les numéros
   > d'origine ayant été attribués entre-temps. Ils sont **facultatifs** : le
   > code de `main` ne dépend d'aucun des deux (`hot_accounts` n'est interrogée
   > nulle part, la colonne `tags` non plus).

3. Récupère dans **Project Settings → API** : l'URL du projet et la clé `service_role`
   (jamais l'anon key — la clé reste côté serveur uniquement).

### 2. Variables d'environnement

Copie `.env.example` vers `.env.local` et remplis :

| Variable | Rôle | Défaut |
|---|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API | requis |
| `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` | requis |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys | requis |
| `APP_USER` / `APP_PASSWORD` | protègent l'app (page de connexion + Basic Auth) | requis en prod |
| `RESEARCH_EXTRACT_MODEL` | modèle de la passe d'extraction : `haiku` (défaut) ou `sonnet` | `haiku` |
| `RESEARCH_MAX_SEARCHES` | nb max de recherches web par qualification | `2` |
| `DAILY_RESEARCH_CAP` | plafond de recherches/analyses par 24 h (nombre d'appels) | `50` |
| `MONTHLY_BUDGET_EUR` | **kill-switch budgétaire** en € — coupe tout au-delà | `15` |
| `BUDGET_PACING` | `off` désarme le lissage sur le mois (voir ci-dessous) | actif |
| `FRESHNESS_TTL_DAYS` | durée de validité du cache de recherche | `14` |
| `AUTO_QUALIFY` | qualification autonome des contacts scrapés (`off` = 100 % manuel) | `on` |
| `JOBS_PER_RUN` | nb max de jobs traités par passage du drain | `8` |
| `CRON_SECRET` | protège les routes cron | requis pour les crons |
| `GITHUB_DISPATCH_TOKEN` / `GITHUB_REPO` | déclenchement instantané du worker de scraping | recommandé |

**Deux barrières budgétaires, pas une.** `MONTHLY_BUDGET_EUR` borne le mois ;
un **lissage** borne le rythme. Au jour D d'un mois de N jours, la dépense
cumulée ne peut excéder `budget × D/N`, plus une réserve de 15 % pour que le
1ᵉʳ du mois reste utilisable. Ce n'est pas une enveloppe qui se périme :
l'autorisation porte sur le cumul, donc une semaine sans usage reste
disponible ensuite. Motivation : en juillet 2026, les 15 € ont été consommés
entre le 1ᵉʳ et le 4, laissant vingt-trois jours sans outil.

**Coût réel d'une qualification : ~0,093 €**, mesuré le 2026-07-27 sur les
160 prospects qualifiés en juillet — soit **~160 prospects/mois** dans 15 €.
Le poste dominant n'est pas le nombre de recherches web mais le volume de
jetons qu'elles rapatrient (~26 500 jetons d'entrée par appel d'extraction).

> ⚠️ Le kill-switch ne protège que ce qu'il **voit**, et il ne voit que la
> somme de `ai_runs.cost_eur` — c'est-à-dire un tarif appliqué à des jetons.
> Les deux moitiés peuvent mentir.
>
> - **Appels non journalisés** : tout script appelant l'API sans passer par
>   `logAiRun` est invisible. `scripts/eval.mjs` (route `eval`) et
>   `scripts/contact-sources/discover.py` (route `discover`) journalisent
>   désormais tous les deux.
> - **Tarif faux** : jusqu'au 2026-07-27, `ANTHROPIC_TARIF` portait le tarif de
>   Haiku 3.5 pour un modèle haiku-4-5 facturé quatre fois plus — 4,34 € de
>   dépense réelle absente d'ai_runs sur le seul mois de juillet. La table est
>   recopiée dans **quatre** fichiers (`lib/constants.js`, `veille/config.py`,
>   `scripts/eval.mjs`, `scripts/contact-sources/discover.py`) : les corriger
>   partout ou pas du tout.
>
> `ai_runs` ne stocke pas le modèle appelé, ce qui rend ce second cas
> indétectable sans rapprochement manuel avec la console. Ajouter la colonne
> est la vraie parade.

⚠️ **`APP_PASSWORD` est obligatoire en production** : sans lui, n'importe qui trouvant l'URL consomme ta clé API Anthropic.

**Connexion** : au premier accès, l'app affiche `/login` (identifiant / mot de passe,
compatible gestionnaires de mots de passe) et conserve la session 30 jours via un
cookie sécurisé. Le formulaire de login est protégé par un **rate-limiting**
(10 tentatives / 15 min par IP). Basic Auth reste accepté en parallèle pour l'outillage.

### 3. En local

```bash
npm install
npm run dev    # → http://localhost:3000
npm test       # tests unitaires — scoring, NBA, schémas, enrich, signaux, budget
```

### 4. Déploiement Vercel

1. Pousse le repo sur GitHub (privé).
2. Sur [vercel.com](https://vercel.com) → **Add New Project** → importe le repo (Next.js détecté).
3. **Settings → Environment Variables** : ajoute les variables ci-dessus.
4. Deploy.

Note : la recherche peut prendre 30-60 s. Les routes web sont en `maxDuration = 300`
(Fluid Compute). Les appels Anthropic **réessaient automatiquement** (jusqu'à 3 tentatives,
back-off respectant `retry-after`) sur 429/529. Vercel **Hobby** = 2 crons max,
1 exécution/jour par cron (voir `vercel.json`).

---

## Fonctionnalités

### Qualification — recherche en 2 passes (anti-hallucination)

La recherche se fait en deux temps, pour ancrer l'analyse dans des faits vérifiés :

1. **Extraction** (`claude-haiku-4-5` par défaut, **web search activé**) : sort des
   faits sourcés et datés. Haiku = ~10× moins cher que Sonnet pour cette tâche simple.
2. **Jugement** (`claude-sonnet-4-6`, **sans web search**) : analyse *uniquement* les
   faits extraits → signaux, score de fit, angles d'accroche. Interdiction de compléter
   par la connaissance générale du modèle.

Bascule possible sans redéploiement : `RESEARCH_EXTRACT_MODEL=sonnet` repasse la passe 1
sur Sonnet. Si l'extraction échoue, repli automatique sur une passe unique (comportement
historique). Le coût est journalisé **par passe** (modèles distincts) dans `ai_runs`.

### Comptes & cartographie DSI

- **Comptes** : une fiche par entreprise (créée à la main, à l'import d'un prospect, ou via SIRENE).
- **Analyse de compte** : recherche web → synthèse, actualités datées/sourcées, **signaux
  stratégiques**, et **organigramme** des décideurs identifiables publiquement (avec niveau
  de fiabilité, confiance sur le poste, fraîcheur). Rien n'est inventé ; tu valides/édites.
- **Comptes chauds** : score de chaleur dérivé des signaux (décroissance temporelle par type).
- **Import SIRENE** : ajoute des ETI/GE depuis l'API officielle (NAF, effectif, région) pour le scoring firmographique.

### Pilotage & analyse

- **Priorités du jour** (page d'accueil) : moteur *Next Best Action* — classe les prospects
  par action prioritaire (relancer, qualifier une réponse, préparer un RDV…).
- **Analyse** (`/analytics`) : coûts IA par jour/route, répartition du pipeline, activité
  commerciale (events), score de fit moyen. Graphiques CSS purs, sans librairie.
- **Export CRM** : CSV / JSON de tous les prospects (avec dernier score et résumé).
- **Timeline `events`** : chaque changement de statut, recherche, génération de brouillon
  est journalisé (base des KPIs commerciaux).

### Veille automatique

Deux mécanismes distincts, qu'il vaut mieux ne pas confondre.

**Rafraîchissement des comptes** — un cron Vercel quotidien (`vercel.json`,
04:30 UTC → `/api/cron/refresh-accounts`) réanalyse les comptes les plus anciens
en *Veille auto*, borné par `DAILY_RESEARCH_CAP` et le budget mensuel. Vercel
Hobby = 2 crons maximum, 1 exécution/jour.

**Module de veille** (`veille/`, Python) — un passage quotidien sur GitHub
Actions (`.github/workflows/veille-daily.yml`, 04:30 UTC) qui collecte des
signaux d'achat hors du portefeuille existant :

```
collecte → filtre lexical → rattachement à un compte → jugement IA → signal
```

- **Sources** : TED (avis de marché et d'attribution, une requête par pays pour
  que le pays le plus prolixe ne confisque pas le quota) et flux RSS/Atom —
  presse IT et salles de presse rattachées à un compte.
- **Jugement** (`claude-haiku-4-5`, sans web search) : ne voit que les documents
  dont le rattachement est fragile ou l'énoncé étranger. Il tranche deux
  questions — est-ce bien ce compte, est-ce un signal d'achat exploitable — et
  on lui demande d'abord de **refuser**. Mesuré : ~0,0005 € par jugement,
  plafonné à `VEILLE_MAX_LLM` par passage, environ 1 document retenu sur 7.
- **Recherche sémantique** : embeddings BGE-M3 (1024 dim., `halfvec`, index
  HNSW cosinus), calculés sur le runner — aucun coût d'API.

Variables (secrets/variables GitHub, toutes facultatives sauf les deux premières) :

| Clé | Rôle | Défaut |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | écriture en base | requis |
| `ANTHROPIC_API_KEY` | sans elle, le passage tourne **sans jugement** | recommandé |
| `VEILLE_MAX_LLM` | jugements par passage | `20` |
| `VEILLE_MAX_DOCS` | documents par source | `400` |
| `VEILLE_FENETRE_JOURS` | fenêtre de collecte générale | `2` |
| `VEILLE_FENETRE_PRESSE` | fenêtre des flux rattachés à un compte | `21` |
| `VEILLE_PAYS` | codes ISO3 collectés | `FRA,DEU,GBR` |
| `VEILLE_MAX_EMBED` | vecteurs calculés par passage | `400` |

Une source peut surcharger sa propre fenêtre via `config.fenetre_jours` en base :
une salle de presse qui publie une fois par mois n'a pas la cadence de TED.

> ⚠️ GitHub Actions exporte `${{ vars.X }}` comme **chaîne vide** quand la
> variable de dépôt n'existe pas. `os.environ.get(nom, defaut)` ne sert alors
> jamais son défaut. `veille/config.py` passe par un helper `_env()` qui traite
> la chaîne vide comme une absence — sans lui, le passage meurt à l'import.

> ⚠️ GitHub **désactive les crons après 60 jours** sans activité sur le dépôt.
> Pour une veille, c'est le pire mode de panne : une collecte arrêtée est
> indiscernable de « rien ne se passe chez mes comptes ». D'où l'étape de signal
> de vie en fin de passage (`VEILLE_HEARTBEAT_URL`).

### Confort

Interface **Fluent 2** avec **mode sombre automatique** (`prefers-color-scheme`), PWA
mobile (barre d'onglets, « Ajouter à l'écran d'accueil »).

---

## Banc d'essai qualité (eval)

Le harnais `scripts/eval.mjs` mesure la qualité des sorties LLM sur un jeu de cas de
référence (grands comptes FR) par appels Anthropic directs en `fetch`. Il n'écrit
aucun résultat en base, mais **journalise sa dépense** dans `ai_runs` (route
`eval`) : elle tombe sur la même facture que l'application, et un garde-fou
budgétaire ne protège que ce qu'il voit.

```bash
npm run eval            # 2 passes (extraction Haiku)
npm run eval:baseline   # mono-passe (comparaison)
npm run eval:night      # extraction Sonnet vs Haiku, sauvegarde dans eval-results/
npm run eval:compare    # compare les 2 derniers résultats

# options : --limit N (smoke test), --pass1-only, --single-pass, --haiku-extract
```

Chaque cas est noté sur 7 critères (signaux présents, score borné/non nul, hooks, résumé,
sources). Les résultats sont écrits dans `eval-results/` (gitignoré).

> Note technique : le web_search d'Anthropic est un **outil serveur** — son nombre d'appels
> se lit dans `usage.server_tool_use.web_search_requests`, pas dans les blocs `tool_use`
> (sinon le coût est compté à 0). Corrigé dans `lib/anthropic.js`.

---

## Outillage d'acquisition de contacts (local, hors app)

Des outils **Python locaux** (hors Vercel) pour trouver des prospects et leurs coordonnées,
en privilégiant le **100% gratuit par scraping** (Scrapling). Voir leurs README dédiés :

- **`scripts/contact-sources/`** — pipeline découverte → extraction → enrichissement.
  - `discover_free.py` : scrape DuckDuckGo (`site:linkedin.com/in`) → extrait nom/poste/société
    depuis les profils LinkedIn publics (sans login). `--from-db N` lit les comptes Supabase,
    `--save` exporte en CSV/JSON. **Gratuit, prouvé**, mais à débit lent (rate limits).
  - `waterfall.py` : enrichissement email gratuit multi-sources (motif + MX + scraping).
    Reproduit la structure de FullEnrich, pas sa couverture (téléphone direct = pas gratuit).
  - `compare.py` / `discover.py` : comparaison de sources à clé (Pappers, Dropcontact, Brave).
  - → [README détaillé](scripts/contact-sources/README.md)
- **`scripts/scrapling-careers/`** — installation du venv Scrapling (réutilisé par les outils
  ci-dessus) ; POC de scraping de pages carrières (abandonné, conservé pour référence).
  - → [README détaillé](scripts/scrapling-careers/README.md)

Ces outils ne sont **pas** déployés : ils tournent sur ta machine, écrivent au plus dans le
même Supabase, et produisent des fichiers gitignorés (données personnelles).

---

## Scraping automatisé via GitHub Actions (alimentation du CRM)

Objectif : **cartographier chaque compte** (décideurs IT) et récupérer leurs **coordonnées**,
automatiquement et en continu, pour alimenter le CRM maison. Un worker GitHub Actions exécute
la découverte sur cron, écrit dans Supabase ; l'app (page **Scraping**) affiche la progression
en direct (polling 5 s) et déclenche un run à la demande. La **qualification 2 passes** reste
dans l'app ; le worker respecte l'**opt-out** et déduplique (`linkedin_url` / `email`).

**Pipeline (validé en production)** :
```
Brave Search API (gratuit) → nom + poste + URL LinkedIn      (lus dans les snippets,
                                                              PAS de fetch LinkedIn)
   → email « motif » (prénom.nom@domaine) + check MX
   → bouton Qualifier → recherche 2 passes (vrai rôle, signaux, score)
```

**Architecture** (le scraping Python ne tourne pas sur Vercel) :
- File Supabase : `scrape_jobs` + `scrape_results` (`supabase/migration-scraping.sql`).
- Worker : `.github/workflows/scrape-worker.yml` → `scripts/contact-sources/worker.py`
  (importe `discover_company` de `discover_free.py` + `enrich_email` de `waterfall.py`).
- App : page `app/scraping/page.js` + routes `app/api/scrape/{enqueue,jobs,jobs/[id],promote}`.

**Variables / secrets** :

| Clé | Emplacement | Rôle | Requis ? |
|---|---|---|---|
| `BRAVE_API_KEY` | secret GitHub | découverte (Brave Search, gratuit 2000/mois) | **oui** |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | secret GitHub | écriture en base | oui |
| `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO` | env Vercel | déclenchement instantané (`repository_dispatch`) | recommandé |
| `SCRAPE_PROXY` | secret GitHub | proxy résidentiel — **marginal** depuis le passage à Brave | optionnel |

**Mise en service** (une fois) :
1. Supabase → SQL Editor → `supabase/migration-scraping.sql`.
2. Clé **Brave Search API** gratuite ([brave.com/search/api](https://brave.com/search/api)) → secret GitHub `BRAVE_API_KEY`.
3. Secrets GitHub `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. (recommandé) PAT fine-grained *Contents: Read and write* → Vercel `GITHUB_DISPATCH_TOKEN` + `GITHUB_REPO=PierreNTE/fox-prospect` → Redeploy.
5. Test : GitHub → **Actions → scrape-worker → Run workflow**, puis app → **Scraping → Lancer**.

**Ce qu'on capte — et ce qui n'est PAS faisable en gratuit** :

| Donnée | Statut | Source |
|---|---|---|
| Nom + entreprise + URL LinkedIn | ✅ fiable | snippets Brave |
| Poste | 🟡 best-effort (parfois société/formation) — le vrai rôle vient de la qualif 2 passes | Brave + LLM |
| **Email** | 🟡 **motif** `prénom.nom@` (confiance basse, non vérifié) | déduction + MX |
| **Téléphone direct / mobile** | ❌ **aucune source gratuite fiable** | réservé aux plateformes payantes |

**Pourquoi cette archi (leçons apprises, à ne pas refaire)** :
- DuckDuckGo renvoie un 202 (soft-block) **même via proxy résidentiel** → on ne scrape pas DDG, on utilise l'**API Brave**.
- Le fetch de profils LinkedIn déconnectés renvoie le **mur d'auth ~100 % via proxy** → on ne fetch **pas** LinkedIn ; nom/poste/URL sont lus dans les **snippets Brave**. Le proxy en devient quasi inutile.
- Un VPS (OVH…) **ne résout rien** : c'est aussi une IP datacenter.

**Limites** :
- Cron **UTC**, +10-30 min possible ; **désactivé après 60 j d'inactivité** (un push/*Run* le réactive).
- Volume : Brave gratuit = 2000 req/mois ≈ 660 entreprises/mois → **~100-300 contacts/mois** (régime qualité). Les **milliers/mois** exigent une plateforme payante (Apollo/Cognism…), pas ce montage.
- Un échec d'**infrastructure** (pas un simple blocage de source) **ouvre une issue GitHub** automatiquement.
- Tout reste dans le **free tier** (Brave 2000/mois, GitHub Actions ~2000 min/mois en repo privé).

---

## Conformité (prospection B2B France)

Régime B2B opt-out : emails professionnels uniquement, message en lien avec la fonction du
contact, possibilité d'opposition dans chaque email, **liste d'opposition permanente**
(statut « opt-out » → email bloqué à tout import futur). À faire de ton côté : documenter
une LIA (analyse d'intérêt légitime) et traiter toute opposition sous 72 h.

L'app elle-même ne scrape pas LinkedIn (recherche via API/sources publiques). Les outils
locaux `contact-sources/` peuvent scraper des profils publics — usage en connaissance des
CGU LinkedIn, sur donnée professionnelle uniquement, source conservée pour chaque donnée.

---

## Itérer sur la qualité

L'essentiel se joue dans `lib/prompts.js` (prompts d'extraction, de jugement et de
génération). Si les accroches sont trop génériques : ajoute des exemples bons/mauvais au
prompt de génération, précise ton offre dans **Réglages**, ou ajuste `RESEARCH_MAX_SEARCHES`.
Mesure l'effet avec le banc d'essai (`npm run eval`).

## Roadmap

- **V1** : import, recherche/qualification, score de fit, accroches, brouillons multi-canal, pipeline, opt-out.
- **V2** : import LinkedIn, enrichissement email/téléphone, Fluent Design, PWA, ICP, scoring déterministe.
- **V3** : comptes & cartographie DSI, signaux d'achat, recherche 2 passes, analytics & events, export CRM, mode sombre, harnais d'eval.
- **V4** : scraping automatisé (worker GitHub Actions + Brave) → découverte continue des décideurs et de leurs coordonnées, alimentation du **CRM maison**.
- **V5** : opportunités et pipeline de vente, agenda/tâches, documents rattachés, copilote IA.
- **V6 (en cours)** : module de veille — collecte TED + presse, rattachement aux comptes,
  jugement IA, recherche sémantique. Le pipeline tourne quotidiennement ; le
  goulot n'est plus la collecte mais la **liste de comptes suivis** — un passage
  type écarte ~160 acheteurs publics réels faute de compte correspondant.

**Connecteurs prévus, pas encore écrits** : `emploi` (France Travail, Adzuna),
`registre` (GLEIF, Companies House), `boamp`, `fts` (Find a Tender — seul moyen
d'avoir des avis britanniques, TED n'en porte plus depuis le Brexit). Leurs
sources existent en base mais sont **désactivées** : `run.py` ne connaît que
`ted` et `rss`, et une source active qu'aucun code n'exécute se présente comme
saine.

### Vision CRM maison

L'objectif est un **mapping complet et tenu à jour de chaque compte** : pour chaque entreprise
cible, l'organigramme des décideurs IT + leurs moyens de contact (email, LinkedIn, téléphone),
avec la **source et la fraîcheur** de chaque donnée. Le système y tend par couches :

- **Comptes & organigramme** : fiche par entreprise + `account_contacts` (cartographie validée).
- **Découverte continue** : scraping Brave → nom/poste/LinkedIn (V4), promus en prospects.
- **Coordonnées** : email par motif (gratuit, confiance basse) ; **téléphone direct = payant** (non couvert en gratuit — cf. section Scraping).
- **Mise à jour** : veille auto (cron) + ré-analyse des comptes ; `events` trace l'historique.
- **Pistes pour aller plus loin** : enrichissement email vérifié (Dropcontact/Pappers), téléphone via provider (Kaspr/Cognism), séquences d'envoi, tracking réponses.

Honnêteté : un mapping **« parfait »** avec **tous** les téléphones directs n'est pas atteignable
gratuitement — c'est le cœur de l'offre des plateformes payantes. Le montage actuel vise un
mapping **riche et fiable sur le nom/poste/LinkedIn/email**, complété à la demande.


---

## Mode 100 % gratuit (par défaut depuis v27)

Aucun service payant n'est appelé tant que tu ne l'autorises pas explicitement.

| Brique | Gratuit (défaut) | Payant (sur autorisation) |
|---|---|---|
| Fiche d'approche | règles + données publiques (`lib/call-prep-free.js`), instantanée | IA Anthropic si `AI_ENABLED=true` (Vercel) |
| Santé société | API Recherche d'entreprises, BODACC | — |
| Site, standard, emails, outils | collecte web + DNS + Wikidata + OpenStreetMap (Nominatim) | Brave côté Vercel si `BRAVE_API_KEY` |
| Recherche du site officiel | agent du worker : **SearXNG local** dans GitHub Actions, site retenu seulement si le SIREN y figure | — |
| Décideurs IT (LinkedIn public) | SearXNG local, extraits de résultats (LinkedIn jamais ouvert) | Brave si variable GitHub `BRAVE_ALLOWED=true`, proxy si `PROXY_ALLOWED=true` |
| Actus | Google Actualités (RSS) | — |
| Marchés publics | BOAMP | — |
| Veille | sans jugement IA | IA si variable GitHub `AI_ENABLED=true` |
| Hébergement | Vercel Hobby, Supabase Free, GitHub Actions (dépôt public) | — |

`AI_ENABLED` absent ⇒ `callClaude` refuse tout appel et le kill-switch budget
est déclenché : aucun chemin ne peut dépenser. Les jobs IA restent en attente
sans consommer de tentative ; les jobs `call_prep` sont faits sans IA.

## Module cold calling Dell (`/leads`)

Flux : **PDF Salesforce → contrôle des sociétés → préparation d'appel → qualif → résumé Salesforce.**

1. **Import** — page **Leads** : choisir l'export *Printable View* d'une liste de leads
   (imprimé en PDF). Le PDF est lu **dans le navigateur** (unpdf) ; seuls le nom de
   société, le statut du lead et la campagne sont envoyés et stockés. Les noms des
   collaborateurs Dell (Account Owner, Buyer Lever) ne sont jamais enregistrés.
2. **Santé société** (gratuit, sans IA) — pour chaque société : SIREN via l'API
   Recherche d'entreprises (indice de commune ou de département lu entre parenthèses),
   état administratif, puis procédures collectives au BODACC. Verdict : *active*,
   *procédure en cours*, *fermée / liquidée* (à clôturer dans Salesforce), *à vérifier*.
   Les comptes importés ont `auto_watch = false` pour ne pas partir dans la veille payante.
3. **Fiche d'approche** (fiche compte, ou en lot depuis **Leads** ; Sonnet + web search,
   ≈ 0,10 € par compte, mise en cache) — interlocuteurs IT identifiés publiquement
   (ajoutés aux contacts du compte, puis « Enrichir » pour email / téléphone),
   standard, site, email générique et format des emails, actualité, angle, et messages
   prêts : email (« Ouvrir dans Outlook », pré-rempli), invitation et message LinkedIn,
   relance J+7, phrases pour passer le standard. « Planifier la séquence » crée les
   tâches dans l'Agenda (email + LinkedIn J0, appel J+3, relance J+7). Rien n'est
   envoyé automatiquement.
4. **Priorité d'appel** (`lib/lead-priority.js`, gratuit, sans IA) — chaque lead reçoit
   une priorité **A / B / C** (0-100) calculée sur les données publiques déjà
   récupérées : effectif, secteur NAF, catégorie INSEE, établissements, CA publié,
   statut Working. Malus : holding (64.20Z), acheteur public, association,
   procédure collective, rapprochement SIRENE incertain. Le détail des points
   s'affiche au survol, avec un angle d'appel orienté infra. La liste est triée par
   priorité, et la préparation en lot traite d'abord les meilleurs comptes, par
   paquets **Top 10 / Top 25** (priorité C exclue par défaut), coût estimé affiché.
   Poids réglables dans `LEAD_PRIORITY_CONFIG`.
5. **Suivi hebdomadaire** (migration v24) — badge **Nouveau** pour les leads apparus
   dans les 7 derniers jours, filtre **Absents du dernier import** pour les leads
   réattribués ou clos dans Salesforce. Sans la migration, l'app fonctionne comme en
   v23 (repli automatique).
6. **Agent automatique** (`lib/leads-agent.js`, migration v25) — à la fin de chaque
   import (ou bouton « Lancer maintenant »), met en file `jobs` (kind `call_prep`) la
   fiche d'approche des comptes **A et B** actifs, ouverts et non préparés, dans l'ordre
   de priorité. Le worker GitHub Actions (toutes les 2 h) et le cron Vercel les
   préparent sans page ouverte. Plafond glissant **`AGENT_PREP_MAX`** fiches / 7 jours
   (défaut 15 ≈ 1,50 €), en plus du kill-switch `MONTHLY_BUDGET_EUR` ; un plafond
   budgétaire ou un crédit Anthropic épuisé replanifie le job au lieu de l'abandonner.
   **ZoomInfo n'est jamais interrogé automatiquement** (licence Dell nominative, accès
   robotisé interdit) : le bouton « ZoomInfo » de la fiche copie le nom et ouvre l'outil.
7. **Radiées → successeur** (`lib/company-successor.js`) — une société fermée ou
   introuvable est recherchée au BODACC : radiation après fusion-absorption / TUP /
   plan de cession (SIREN cités, clé de Luhn), annonces citant son nom d'un bloc
   (« ancienne dénomination », « précédent propriétaire »). Successeur actif : le
   compte redevient appelable sous son identité (`health_detail.successor`,
   `predecessor`). Homonyme actif seul : simple piste. Bouton « Rechercher les
   repreneurs » sur /leads.
8. **Collecte d'infos publiques** (`lib/account-intel.js`, migration v26, gratuit,
   sans IA) — site officiel (site connu → Wikidata par SIREN → Brave Search si
   `BRAVE_API_KEY` → domaines devinés existant au DNS), vérifié par le SIREN des
   mentions légales ; accueil + mentions + contact + à propos + recrutement (robots.txt
   respecté) : standard, emails, LinkedIn société, hébergeur, outils cités (VMware,
   Veeam, NetApp…) ; DNS : messagerie (Microsoft 365 / Google), passerelle, DMARC,
   services SaaS (SPF / TXT) ; emails probables des dirigeants (motif observé ou
   courant, seulement si le domaine a un MX) ; acheteur public : avis BOAMP
   informatiques. Lancée après chaque import (page ouverte) et par le cron Vercel du
   matin (`INTEL_PER_CRON`, défaut 15) — indépendante de GitHub Actions et du crédit IA.
9. **Décideurs IT (worker de scraping)** — l'agent envoie aussi les comptes A/B actifs
   au worker `scrape-worker` (GitHub Actions, contrôle toutes les 15 min, gratuit, sans IA) :
   découverte des postes IT et emails, résultats dans **Scraping** (à promouvoir en
   contacts). Un compte n'est envoyé qu'une fois ; plafond `SCRAPE_WEEKLY_MAX`
   (défaut 25 / 7 jours). Les jobs des leads passent avant ceux de la veille.
