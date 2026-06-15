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

Coût de fonctionnement : ~0,06-0,16 € par prospect qualifié (recherche web 2 passes +
génération). Vercel et Supabase en free tier. Tous les appels LLM sont journalisés
(table `ai_runs`) et visibles dans la page **Analyse**.

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
   | `supabase/migration-v1.sql` | companies (SIREN), company_signals (signaux d'achat datés) |
   | `supabase/migration-v2.sql` | `settings.icp`, `prospects.email_confidence/email_source` |
   | `supabase/migration-v3.sql` | `events` (timeline commerciale), `push_subscriptions` |

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
| `RESEARCH_MAX_SEARCHES` | nb max de recherches web par qualification | `4` |
| `DAILY_RESEARCH_CAP` | plafond de recherches/analyses par 24 h (sécurité budget) | `50` |
| `FRESHNESS_TTL_DAYS` | durée de validité du cache de recherche | `14` |
| `CRON_SECRET` | protège les routes cron (veille auto) | requis pour la veille |
| `WATCH_BATCH` | nb de comptes rafraîchis par passage de veille | `2` |
| `FRANCE_TRAVAIL_CLIENT_ID` / `_SECRET` | collecte des offres IT (signaux recrutement) | optionnel |

⚠️ **`APP_PASSWORD` est obligatoire en production** : sans lui, n'importe qui trouvant l'URL consomme ta clé API Anthropic.

**Connexion** : au premier accès, l'app affiche `/login` (identifiant / mot de passe,
compatible gestionnaires de mots de passe) et conserve la session 30 jours via un
cookie sécurisé. Le formulaire de login est protégé par un **rate-limiting**
(10 tentatives / 15 min par IP). Basic Auth reste accepté en parallèle pour l'outillage.

### 3. En local

```bash
npm install
npm run dev    # → http://localhost:3000
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

Deux crons Vercel quotidiens (`vercel.json`) : `refresh-accounts` (réanalyse les comptes
les plus anciens en *Veille auto*, dans la limite de `DAILY_RESEARCH_CAP`/`WATCH_BATCH`)
et `collect-signals` (offres IT France Travail + marchés publics BOAMP).

### Confort

Interface **Fluent 2** avec **mode sombre automatique** (`prefers-color-scheme`), PWA
mobile (barre d'onglets, « Ajouter à l'écran d'accueil »).

---

## Banc d'essai qualité (eval)

Le harnais `scripts/eval.mjs` mesure la qualité des sorties LLM sur un jeu de cas de
référence (grands comptes FR), sans toucher la base — appels Anthropic directs en `fetch`.

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

## Scraping automatisé via GitHub Actions

Pour que la découverte/enrichissement tourne **sans ta machine** et **gratuitement**, un
worker GitHub Actions exécute les scripts `contact-sources/` sur cron et écrit dans Supabase.
L'app (page **Scraping**) lit la progression en direct (polling 5 s) et peut déclencher un
run à la demande. La **qualification 2 passes** reste dans l'app (appels Anthropic, OK en
serverless) ; le worker respecte l'**opt-out** et déduplique (`linkedin_url` / `email`).

**Architecture** (le scraping Python ne peut pas tourner sur Vercel) :
- File de jobs Supabase : `scrape_jobs` + `scrape_results` (migration `supabase/migration-scraping.sql`).
- Worker : `.github/workflows/scrape-worker.yml` → `scripts/contact-sources/worker.py`.
- App : page `app/scraping/page.js` + routes `app/api/scrape/{enqueue,jobs,jobs/[id],promote}`.

**Mise en service** (une fois) :
1. Supabase → SQL Editor → exécuter `supabase/migration-scraping.sql`.
2. GitHub → repo → **Settings → Secrets and variables → Actions** → secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Créer un **PAT fine-grained** (Settings → Developer settings → Fine-grained tokens) : accès au repo `fox-prospect`, permission **Contents : Read and write** (exigée par l'API `repository_dispatch`).
4. Vercel → Environment Variables : `GITHUB_DISPATCH_TOKEN` (le PAT) + `GITHUB_REPO` (`PierreNTE/fox-prospect`) → Redeploy.
5. Test : GitHub → **Actions → scrape-worker → Run workflow** (doit finir vert même sans job en file). Puis dans l'app : **Scraping → Lancer**.

**Déclenchement** : à la demande (bouton *Lancer* → `repository_dispatch`, ~secondes) ou
automatique (cron `0 */6 * * *`). Sans PAT, seul le cron prend le relais (dégradation gracieuse).

**Proxy résidentiel (indispensable pour le scraping LinkedIn depuis GitHub)** :
les runners ont une **IP datacenter** que DuckDuckGo/LinkedIn bloquent → sans proxy,
les jobs finissent `done` mais avec `stats.blocked` élevé et **0 contact** (vérifié).
Pour franchir le mur : ajoute un **proxy résidentiel** (≈10-12 €/mois en faible volume)
dans le secret GitHub **`SCRAPE_PROXY`** (`http://user:pass@host:port`). Scrapling route
alors toutes ses requêtes via ce proxy. Sans `SCRAPE_PROXY`, le worker tourne quand même
(utile pour les collecteurs API non bloqués) mais le LinkedIn ne donnera rien.
> ⚠️ Un VPS (OVH…) **ne résout pas** le blocage : c'est aussi une IP datacenter. Seul un
> proxy résidentiel change la donne — pas l'endroit où tourne le worker.

**Limites à connaître** :
- Cron en **UTC**, déclenchement réel possible 10-30 min après l'heure ; **désactivé après 60 j d'inactivité** du repo (un push ou un *Run workflow* le réactive).
- Runners en **IP datacenter** → sans proxy résidentiel, DuckDuckGo/LinkedIn bloquent (voir ci-dessus). Le worker ne plante jamais.
- Un échec d'**infrastructure** (pas un simple blocage de source) **ouvre une issue GitHub** automatiquement.
- Tout reste dans le **free tier** (GitHub Actions ~2000 min/mois en repo privé).

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
- **V3** : comptes & cartographie DSI, signaux d'achat (SIREN/BOAMP/France Travail), veille auto, recherche 2 passes, analytics & events, export CRM, mode sombre, harnais d'eval.
- **Pistes** : rotation multi-moteurs pour l'acquisition gratuite, intégration providers (Dropcontact/Pappers), séquences d'envoi, tracking réponses.
