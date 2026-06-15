# Fox Prospect — Audit Stratégique Complet

> **Date :** 14 juin 2026  
> **Périmètre :** Code source complet (Next.js 14, Supabase, Anthropic claude-sonnet-4-6, Vercel)  
> **Objectif :** Transformer Fox Prospect en la meilleure plateforme de prospection B2B IT France — génération automatique de prospects qualifiés, à jour, exploitables commercialement.

---

## Table des matières

1. [Synthèse exécutive](#1-synthèse-exécutive)
2. [Audit par dimension](#2-audit-par-dimension)
3. [Conceptions cibles](#3-conceptions-cibles)
4. [Roadmap priorisée](#4-roadmap-priorisée)
5. [Architecture cible](#5-architecture-cible)
6. [Top risques & parades](#6-top-risques--parades)
7. [KPIs à instrumenter](#7-kpis-à-instrumenter)

---

## 1. Synthèse exécutive

Fox Prospect est un MVP **honnête et fonctionnel** pour un commercial IT solo. Il résout le vrai problème : obtenir des signaux d'achat datés/sourcés et des brouillons calibrés sans effort. La stack (Next.js/Supabase/Anthropic) est saine, le code est lisible, les prompts sont sérieux dans leur posture anti-fabrication.

**Mais il n'est pas prêt pour la promesse de "génération automatique maximale de prospects qualifiés".**

Cinq verrous bloquants, par ordre de criticité commerciale :

1. **L'acquisition est 100% manuelle.** 50 noms codés en dur, un CSV, une URL LinkedIn. Pas de pipeline de découverte automatique. Fox ne trouve pas de prospects — c'est Pierre qui les trouve pour Fox.
2. **Les signaux d'achat sont morts dans du JSONB non requêtable.** `accounts.signals` est un tableau opaque. Impossible de répondre à "quels comptes ont un recrutement RSSI de moins de 30 jours sans prospect contacté" — qui est LA requête qui génère des RDV.
3. **Il n'y a pas de clé d'entreprise canonique.** Pas de SIREN, pas de NAF, pas d'effectif. Le dédoublonnage se fait sur `lower(name)`, qui échoue sur "Renault" vs "Renault Group". Le scoring ICP est structurellement impossible.
4. **Le fit_score est une boîte noire.** Un entier 0-100 généré par le LLM sans formule, non recalculable, non comparable entre prospects. Trier sa journée là-dessus revient à trier sur du bruit.
5. **L'anti-hallucination repose à 100% sur des instructions de prompt.** Aucune URL n'est vérifiée programmatiquement. Un signal inventé présenté à un DSI détruit la relation avant même qu'elle commence.

**Les notes de santé par dimension :**

| Dimension | Note /10 | Criticité |
|---|---|---|
| Sécurité & Conformité | 4/10 | Critique |
| Performance & Robustesse | 3.5/10 | Élevée |
| Base de données | 3.5/10 | Critique |
| Robustesse IA & Anti-hallucination | 3.5/10 | Critique |
| Architecture & Scalabilité | 4/10 | Élevée |
| Qualité du code & Maintenabilité | 5/10 | Moyenne |
| Coûts d'exploitation | 5/10 | Élevée |
| Qualité des données | 3/10 | Critique |
| UX/UI & Design System | 5/10 | Moyenne |

**Chemin vers la plateforme cible :** le MVP est à 3 mois de devenir un outil commercial redoutable (V1), et à 9-12 mois de concurrencer Apollo/Cognism sur le créneau IT France (V2). Le verrou n°1 à lever immédiatement est sécuritaire (secrets en clair). Le verrou n°2 est structurel : SIREN + table signals + scoring déterministe. Tout le reste s'appuie dessus.

---

## 2. Audit par dimension

### 2.1 Sécurité & Conformité — 4/10

#### Forces
- RLS activé sur toutes les tables, clé `service_role` uniquement côté serveur (`lib/supabase.js`) — surface d'attaque API publique nulle.
- Table `optout` permanente avec email en PK : bonne implémentation RGPD de la liste d'opposition.
- APP_PASSWORD protège l'app contre une exposition accidentelle de la clé Anthropic.
- Le cron est protégé par `CRON_SECRET` distinct.

#### Faiblesses critiques

**🚨 P0 — Secrets en clair dans `batch-research.mjs` (non commité mais présent dans le dépôt)**
Le fichier contient la clé Supabase `service_role` (ligne 6), l'URL du projet, et les identifiants Basic Auth en Base64 décodable (ligne 8). La `service_role` contourne la RLS : sa fuite = lecture/écriture totale de la base. Le fichier n'est pas encore dans l'historique git (gitignoré depuis, OK), mais **les secrets sont toujours actifs**.
→ **Révoquer immédiatement la clé service_role Supabase et changer APP_PASSWORD.**

**APP_PASSWORD optionnel** — sans lui, l'app est **entièrement ouverte** (`middleware.js` ligne 14 : `if (!password) return NextResponse.next()`). Un déploiement Vercel sans cette variable expose la clé Anthropic à n'importe qui connaissant l'URL.

**Cookie de session non expirant** — le token est `SHA-256("user:password:fox-session-v1")`. Un cookie volé est valide **indéfiniment** jusqu'au changement de mot de passe. Aucune expiration serveur, aucune liste de révocation, aucun refresh.

**Comparaison non constante** — `middleware.js` ligne 34 : `if (u === user && p === password)` compare en temps variable (susceptible à timing attack, bien que peu critique en mono-user).

**Absence de rate-limiting** — la page `/login` et les routes API n'ont aucune protection contre le brute-force. Vercel ne fournit pas de rate-limit par défaut.

**RGPD incomplet** :
- Pas de LIA (Legitimate Interest Assessment) documentée.
- Pas de registre de traitements.
- Pas de purge automatique des prospects inactifs/opt-out anciens.
- Pas de réponse aux droits (accès, effacement, portabilité) en dehors du statut opt-out.

#### Recommandations

| # | Titre | Impact | Complexité | ROI | Priorité |
|---|---|---|---|---|---|
| S1 | Révoquer les secrets + purger `batch-research.mjs` de l'historique | 5 | 1 | Très élevé | **P0** |
| S2 | Rendre APP_PASSWORD obligatoire (validation au démarrage) | 4 | 1 | Élevé | **P0** |
| S3 | Expiration des sessions (timestamp dans le cookie + vérification) | 3 | 2 | Élevé | P1 |
| S4 | Rate-limiting sur `/login` (compteur en mémoire ou Upstash) | 3 | 2 | Moyen | P1 |
| S5 | LIA + registre de traitements documentés (Word/Notion) | 3 | 1 | Élevé | P1 |
| S6 | Purge automatique des prospects opt-out > 36 mois (cron) | 3 | 2 | Moyen | P2 |

---

### 2.2 Architecture & Scalabilité — 4/10

#### Forces
- Stack Next.js App Router / Supabase / Vercel : pragmatique, bien adaptée au solo.
- Fluid Compute (maxDuration=300) exploité correctement sur toutes les routes longues.
- Retry et back-off sur les appels Anthropic (lib/anthropic.js) — bonne résilience au rate-limit.
- Le principe "IA propose, Pierre valide" est une décision d'architecture correcte pour un solo.

#### Faiblesses

**Batch côté client** — `runBatch` (app/accounts/page.js l.52-91) : boucle `for` dans le navigateur, fetch séquentiel, l'onglet doit rester ouvert 20-30 minutes. Pas de reprise, pas de persistance, inutilisable depuis mobile.

**Absence de file de jobs** — aucun mécanisme asynchrone (queue, worker). Toute opération longue est synchrone dans la requête HTTP. Les routes 300s sont une béquille, pas une solution.

**Mono-tenant structurel** — pas de table `users`/`orgs`/`memberships`, aucune colonne `org_id`. Ajouter un deuxième commercial impose une refonte complète + backfill + réécriture de toutes les requêtes.

**Absence de couche de service** — la logique métier est dans les routes API directement. Tester, réutiliser, ou porter sur un autre runtime est difficile.

**Boucles N+1** — `analyzeAccount` insère les contacts un par un (`lib/account-analyze.js` l.59-77) puis update les managers un par un (l.84-91). Sur 30 contacts = 60 allers-retours séquentiels.

#### Recommandations

| # | Titre | Impact | Complexité | ROI | Priorité |
|---|---|---|---|---|---|
| A1 | File de jobs asynchrone (table `jobs`, cron dépileur) | 5 | 4 | Élevé | P1 |
| A2 | Batch d'insertion contacts (`supabase.from(...).insert([...])`) | 3 | 2 | Élevé | P1 |
| A3 | Préparer le multi-tenant : ajouter `org_id` au schéma dès la refonte | 2 | 5 | Moyen | P3 |

---

### 2.3 Qualité du code & Maintenabilité — 5/10

#### Forces
- Code lisible, fichiers bien découpés (lib/prompts, lib/anthropic, lib/account-analyze).
- callClaudeJson avec passe de réparation JSON : pragmatique et économe.
- Commentaires pertinents sur les décisions non-évidentes (auth, anti-écrasement).

#### Faiblesses

**Aucun test, aucun lint, aucun TypeScript** — les prompts renvoient du JSON dynamique ; sans types ni validation de schéma, une régression de format casse silencieusement toute la chaîne.

**Parsing JSON fragile** — `extractJson` (lib/anthropic.js l.72-83) : slice de la première `{` à la dernière `}`. Un `}` dans un summary (ex. "le projet coûte {1M€}") corrompt l'extraction.

**Magic strings de statuts** — `"nouveau"`, `"recherché"`, `"contacté"`, `"opt-out"` sont répétés dans le code, l'UI et la DB sans source de vérité centralisée. Une coquille fragmente le reporting.

**Duplication de la logique de cap quotidien** — écrite différemment dans research/route.js (compte les lignes research) et dans analyze/route.js (compte les accounts par last_refreshed_at). Métriques incompatibles.

**Couplage UI/fetch** — la logique de batch (app/accounts/page.js) mélange fetch, état React et logique métier dans un seul composant de 200 lignes.

#### Recommandations

| # | Titre | Impact | Complexité | ROI | Priorité |
|---|---|---|---|---|---|
| C1 | Validation Zod sur toutes les sorties LLM (5 schémas) | 4 | 2 | Élevé | **P0** |
| C2 | Centraliser les constantes (statuts, enums) dans `lib/constants.js` | 3 | 1 | Élevé | P1 |
| C3 | TypeScript (migration progressive, jsconfig.json → tsconfig) | 2 | 4 | Moyen | P2 |
| C4 | Tests unitaires sur `computeScores` et `extractJson` (Jest/Vitest) | 3 | 3 | Moyen | P2 |

---

### 2.4 Performance & Robustesse des traitements — 3.5/10

#### Forces
- DAILY_RESEARCH_CAP plafonne les appels coûteux (évite la facture incontrôlée).
- Retry avec back-off exponentiel sur 429/529 (lib/anthropic.js l.32-57).
- Passe de réparation JSON sans web_search (économie réelle sur les erreurs de format).
- Anti-écrasement des contacts validés (lib/account-analyze.js l.45-50).

#### Faiblesses (issues de l'audit agent)

| Faiblesse | Criticité |
|---|---|
| Aucun cache / TTL : chaque clic relance une recherche web complète facturée | Élevée |
| Batch 100% côté client (onglet ouvert obligatoire, pas de reprise) | Élevée |
| Timeout composé : back-off 60s×5 ≈ 210s pure attente + recherche web → peut dépasser 300s | Élevée |
| Cap non atomique (check-then-act) → race condition sous concurrence | Moyenne |
| Boucles N+1 sur inserts contacts/managers | Moyenne |
| `data.usage` retourné mais jeté : coût réel en tokens inconnu | Élevée |
| Échecs silencieux dans le batch (catch vide, ligne 84-86) | Faible |

#### Recommandations

| # | Titre | Impact | Complexité | ROI | Priorité |
|---|---|---|---|---|---|
| P0 | Cache de fraîcheur TTL (FRESHNESS_TTL_DAYS, défaut 14j) avant toute (ré)analyse | 5 | 2 | Très élevé | **P0** |
| P1 | Table `ai_runs` : idempotence + comptabilité tokens/euros | 4 | 3 | Très élevé | **P0** |
| P2 | File de jobs asynchrone pour le batch (reprenable, sans onglet ouvert) | 5 | 4 | Élevé | P1 |
| P3 | AbortController + deadline interne ~250s + back-off recalibré (3 tentatives max 20s) | 3 | 2 | Élevé | P1 |
| P4 | Décompte du cap via RPC SQL atomique (au lieu du check-then-act) | 3 | 3 | Moyen | P2 |
| P5 | Vérification légère des URLs sources (HEAD fetch, statut stocké) | 4 | 2 | Élevé | P2 |

---

### 2.5 Coûts d'exploitation — 5/10

#### Estimation des coûts actuels

**claude-sonnet-4-6** (tarifs 2026) : ~$3/M tokens input, ~$15/M tokens output.  
`web_search_20250305` : ~$10/1000 recherches.

| Opération | Tokens estimés | Recherches web | Coût estimé |
|---|---|---|---|
| Qualification prospect (research) | ~4000 input + ~2500 output | 4 | **~0,04-0,06€** |
| Analyse compte (analyze) | ~5000 input + ~3500 output | 4 | **~0,05-0,08€** |
| Enrichissement email (enrich) | ~3000 input + ~1500 output | 4 | **~0,04-0,06€** |
| Import LinkedIn | ~2500 input + ~1000 output | 4 | **~0,03-0,05€** |

**Veille sur 1 000 comptes à raison de 2/jour (actuel) :** ~500 jours de cron = 16 mois pour couvrir tout le portefeuille une fois. Coût : ~50-80€/mois.  
**Veille sur 1 000 comptes à raison de 10/jour :** ~100 jours. Coût : ~100-160€/mois.  
**Veille sur 5 000 comptes / 10 par jour :** ~500 jours. Coût : ~500-800€/mois — pas viable sans optimisation.

#### Faiblesse majeure : zéro visibilité sur les coûts réels

`data.usage` (tokens + web_search count) est retourné par `callClaude` (lib/anthropic.js l.67) mais **jeté par tous les appelants**. Impossible de calculer le coût par lead qualifié. Une régression de prompt (sortie 2× plus longue) gonflerait la facture sans aucune alerte.

#### Recommandations

| # | Titre | Impact | ROI | Priorité |
|---|---|---|---|---|
| F1 | Persister `usage` dans `ai_runs` (input/output tokens, nb web_search, coût_eur) | 4 | Très élevé | **P0** |
| F2 | Dashboard coût/jour en euros (calcul automatique depuis tarifs versionnés) | 4 | Élevé | P1 |
| F3 | Utiliser claude-haiku-4-5 pour le tri/filtrage ICP (collecte > scoring léger) | 4 | Très élevé | P1 |
| F4 | Cache de résultats firmo (SIREN → NAF/effectif, TTL 90j) — zéro LLM | 5 | Très élevé | P1 |
| F5 | Découpler collecte gratuite (APIs publiques) et qualification LLM (chère) | 5 | Très élevé | P0 |

---

### 2.6 Base de données — 3.5/10

Détail complet produit par l'agent spécialisé. Résumé des fautes capitales :

#### Fautes critiques

**Aucun identifiant canonique d'entreprise.** `accounts.name` est la seule clé (`unique(lower(name))`). "Société Générale" ≠ "Societe Generale" ≠ "SG" = 3 comptes distincts. Le rattachement `ilike` (prospects/route.js l.91) crée des doublons silencieusement. La France a SIREN (gratuit, officiel) — ne pas l'utiliser est une erreur de conception.

**Signaux métier dans du JSONB non requêtable.** `research.signals`, `accounts.news`, `accounts.signals` sont des JSONB. Impossible de filtrer, trier ou scorer en SQL sur le contenu le plus précieux. L'unique usage est `(a.signals || []).length` — on compte, on ne comprend pas.

**Aucune table d'événements/timeline.** Le statut `prospects.status` est un texte écrasé sur place. Zéro trace de "contacté le", "répondu le", "RDV le". Les KPIs commerciaux (taux de réponse, délai de cycle, conversion par étape) sont structurellement incalculables.

#### Schéma cible (DDL clé)

```sql
-- Référentiel entreprises (SIREN = clé pivot)
create table companies (
  id         bigint generated always as identity primary key,
  siren      char(9) unique,
  domain     citext unique,
  name       text not null,
  name_norm  text generated always as (lower(unaccent(name))) stored,
  naf_code   char(5),
  effectif_tranche text,
  effectif_min int, effectif_max int,
  region_code char(2), commune text,
  categorie  text,       -- PME/ETI/GE
  etat_admin text,       -- A=actif/C=cessé
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index companies_name_trgm on companies using gin (name_norm gin_trgm_ops);
create index companies_naf_idx   on companies (naf_code);

-- Signaux d'achat datés et requêtables (exit jsonb)
create type signal_type as enum
  ('financement','recrutement','nomination','techno','rfp','expansion','reglementaire','incident','autre');

create table signals (
  id          bigint generated always as identity primary key,
  company_id  bigint references companies(id) on delete cascade,
  contact_id  bigint references contacts(id) on delete set null,
  type        signal_type not null,
  detail      text not null,
  observed_at date not null,     -- vraie date, pas du texte
  source_url  text,
  confidence  numeric(3,2),
  status      text not null default 'nouveau'
              check (status in ('nouveau','traité','écarté')),
  base_weight int default 0,
  created_at  timestamptz default now()
);
create index signals_company_fresh on signals (company_id, observed_at desc);
create index signals_unread on signals (observed_at desc) where status = 'nouveau';

-- Timeline d'événements (KPIs commerciaux)
create table events (
  id          bigint generated always as identity primary key,
  contact_id  bigint references contacts(id) on delete cascade,
  company_id  bigint references companies(id),
  kind        text not null, -- status_change/email_sent/reply/call/rdv
  from_status text, to_status text,
  occurred_at timestamptz not null default now()
) partition by range (occurred_at);

-- Table de scores décomposés (audit, explicabilité)
create table scores (
  contact_id      bigint primary key references contacts(id) on delete cascade,
  global_score    smallint,
  urgency_score   smallint,
  it_maturity_score smallint,
  business_score  smallint,
  accessibility_score smallint,
  breakdown       jsonb default '{}',
  weights_version text default 'v1',
  computed_at     timestamptz default now()
);
```

#### Recommandations

| # | Titre | Impact | Complexité | ROI | Priorité |
|---|---|---|---|---|---|
| B1 | Table `companies` pivotée SIREN via recherche-entreprises.api.gouv.fr | 5 | 4 | Très élevé | **P0** |
| B2 | Table `signals` relationnelle (exit jsonb accounts.news/signals) | 5 | 4 | Très élevé | **P0** |
| B3 | Table `events` append-only + partitionnement mensuel | 5 | 3 | Très élevé | **P0** |
| B4 | Table `scores` décomposés + colonne calculée total | 4 | 3 | Élevé | P1 |
| B5 | Remplacer dédoublonnage RAM+N+1 par `INSERT ON CONFLICT` | 3 | 3 | Élevé | P1 |
| B6 | Passer `data_date` TEXT → `date`, statuts TEXT → enums/CHECK | 3 | 2 | Élevé | P1 |
| B7 | Migrations versionnées Supabase (exit SQL Editor manuel) | 2 | 2 | Moyen | P2 |

---

### 2.7 Robustesse IA & Anti-hallucination — 3.5/10

#### Forces
- Prompts sérieux avec règle « QUALITÉ AVANT QUANTITÉ » martelée.
- Datation + source par signal formalisées DANS le schéma JSON demandé.
- `reliability` et `role_confidence` validés par allow-list avant insertion (lib/account-analyze.js l.68-69) — le seul garde-fou programmatique du codebase.
- Principe « IA propose, Pierre valide » (validated=false) — anti-hallucination par design.

#### Faiblesses critiques

**Zéro vérification programmatique des URLs.** Chaque URL de `sources`/`signal.source` est insérée telle quelle et affichée comme `<a href={u}>` cliquable. Une URL hallucinée (404, mauvaise entreprise, page paywall) est visuellement indiscernable d'une vraie source. Une citation morte envoyée à un DSI = perte du compte.

**Auto-déclaration du niveau de fiabilité.** Le LLM s'attribue lui-même `reliability: "verifie"`. Le code valide juste que la chaîne appartient à l'enum (l.68) sans jamais compter les sources distinctes. `reliability: "verifie"` peut reposer sur zéro source réelle.

**fit_score opaque.** 0-100 sans formule, non recalculable, non borné programmatiquement (`result.fit_score ?? null` accepte "85%" ou 120). Non comparable entre deux prospects.

**Extraction et jugement mélangés.** Le prompt research demande dans le même appel de chercher (faits) ET de juger (fit_score, hooks prêts à l'emploi). Pour produire une accroche percutante, le LLM est incité à combler les trous factuels.

**Aucune éval.** Le commentaire l.2 de lib/prompts.js dit "itère comme sur du code : test, mesure" — mais il n'existe aucun harnais de mesure. Toute modification de prompt est un pari aveugle.

#### Recommandations

| # | Titre | Impact | Complexité | ROI | Priorité |
|---|---|---|---|---|---|
| I1 | Vérification programmatique des URLs sources (HEAD fetch + statut stocké) | 5 | 3 | Très élevé | **P0** |
| I2 | Validation Zod sur toutes les sorties LLM (types, dates, enums, ranges) | 3 | 2 | Élevé | **P0** |
| I3 | fit_score déterministe : LLM extrait les features, JS/SQL calcule le score | 4 | 3 | Élevé | P1 |
| I4 | Scoring de confiance des sources par recoupement (≥2 domaines distincts = "verifie") | 4 | 4 | Élevé | P2 |
| I5 | Harnais d'évals automatisées sur jeu figé (15-25 prospects "gold", `npm run eval`) | 3 | 3 | Moyen | P2 |
| I6 | Séparer extraction (facts, web_search) et jugement (score, hooks, sans web_search) | 3 | 3 | Moyen | P3 |

---

### 2.8 Qualité des données — 3/10

#### Problèmes

- **Complétude faible** : `role`, `email`, `phone` souvent vides. Email "déduit" par pattern = confiance basse souvent présentée comme suffisante.
- **Fraîcheur non mesurable** : `data_date` est TEXT (`"2024-02"`, `"mars 2024"`, `""` — tous valides). Impossible de trier par fraîcheur ou de détecter une fiche obsolète en SQL.
- **Dédoublonnage fragile** : clé `first_name|last_name|company` en lower exact. "Jean-Pierre" ≠ "Jean Pierre" ≠ "J.-P. Dupont" = 3 prospects distincts.
- **Aucune clé d'entreprise canonique** : sans SIREN, deux fiches sur la même entreprise coexistent indéfiniment.
- **Vérification de fonction absente** : rien ne vérifie qu'un "DSI de Société Générale" est toujours en poste. Les nominations changent tous les 2-3 ans en moyenne.
- **Aucune règle de péremption** : un signal de 2023 pèse autant qu'un signal de la semaine dernière.

#### Recommandations

| # | Titre | Impact | Complexité | ROI | Priorité |
|---|---|---|---|---|---|
| D1 | SIREN comme clé canonique + résolution via annuaire-entreprises.api.gouv.fr | 5 | 3 | Très élevé | **P0** |
| D2 | Score de complétude par enregistrement (% champs renseignés, affiché en UI) | 3 | 2 | Élevé | P1 |
| D3 | `data_date` → `date` Postgres + règle de péremption (contact > 18 mois → "à re-vérifier") | 4 | 2 | Élevé | P1 |
| D4 | Déduplication floue (Levenshtein ≤ 2 sur nom normalisé) avant tout import | 3 | 3 | Élevé | P2 |
| D5 | Re-vérification périodique des contacts (cron mensuel : fonction ≥ 18 mois → flag) | 3 | 3 | Moyen | P2 |

---

### 2.9 UX/UI & Design System — 5/10

#### Forces
- Fluent Design appliqué avec soin : variables CSS, ombres, accrylique, animations réduites.
- WCAG AA respecté sur les contrôles et les textes secondaires.
- PWA fonctionnelle (manifest + service worker), nav mobile en bottom bar.
- Copier les brouillons en un clic : bonne intuition du workflow commercial.
- Organigramme récursif éditable : unique sur le marché.

#### Faiblesses

**Pas de dashboard.** L'écran `/` est une table de prospects non triée. Aucun indicateur de "quoi faire aujourd'hui" — c'est le plus grand gap UX face à Apollo/Attio.

**Pas de filtres, tri, saved views.** La seule recherche est un filtre texte client. Pour 500 prospects, c'est ingérable.

**Pas d'actions en masse.** Impossible de qualifier 10 prospects d'un coup, de les marquer "contactés" en lot, ou de déclencher une analyse en masse sans garder l'onglet ouvert.

**Pas de visualisations.** Le score est un chiffre brut. Aucune timeline, aucun graphe de signaux, aucun indicateur visuel de chaleur ou de fraîcheur.

**Organigramme basique.** Le composant `OrgTree` est un arbre d'indentation avec des cartes. Sans interactivité (drag & drop, zoom, export), il ne rivalise pas avec des outils dédiés.

**Pas de palette de commandes.** Pour un power user, l'absence de Cmd+K (style Linear/Notion) est frustrante.

**Design system non composable.** Une seule feuille CSS de 520 lignes, aucune bibliothèque de composants, pas de tokens d'espacement/typo systématiques. Difficile de faire évoluer le design sans tout casser.

**Pas de mode sombre.** La CSS utilise des valeurs codées en dur, pas de `prefers-color-scheme`.

#### Parcours cibles (objectif : < 3 clics pour obtenir un prospect exploitable)

**Parcours actuel :** Comptes → Créer → Analyser (attendre 30-90s) → Fiche → Lancer recherche (attendre) → Générer brouillons → Copier → 7+ clics.

**Parcours cible :** Dashboard → Carte "compte chaud" (signal pré-calculé affiché) → Bouton "Générer accroche triggered" → Copier → **3 clics**.

#### Recommandations

| # | Titre | Impact | Complexité | ROI | Priorité |
|---|---|---|---|---|---|
| U1 | Dashboard "Comptes chauds" : 5-8 cartes/jour avec signal + action recommandée | 5 | 3 | Très élevé | **P0** |
| U2 | Tri et filtres sur la piste (score, statut, date, secteur, signal type) | 4 | 3 | Élevé | P1 |
| U3 | Scores visuels décomposés (5 barres + explication ligne à ligne) | 4 | 2 | Élevé | P1 |
| U4 | Timeline d'événements par prospect/compte | 4 | 3 | Élevé | P2 |
| U5 | Organigramme interactif (zoom, drag, export PNG/SVG) | 3 | 4 | Moyen | P2 |
| U6 | Palette de commandes Cmd+K (recherche globale, actions rapides) | 3 | 3 | Moyen | P3 |
| U7 | Mode sombre (variables CSS suffisent, `prefers-color-scheme`) | 2 | 2 | Faible | P3 |

---

## 3. Conceptions cibles

### 3.1 Acquisition automatique multi-sources

**Objectif :** Passer de 50 noms codés en dur à une file priorisée et datée de centaines d'entreprises chaudes, alimentée gratuitement et automatiquement.

#### Architecture

```
[Collecteurs API gratuits — cadence quotidienne]
   ├── INSEE SIRENE (NAF, effectif, région, état admin)
   ├── recherche-entreprises.api.gouv.fr (résolution nom→SIREN)
   ├── INPI/RNE (dirigeants open data)
   ├── BODACC (créations, cessions, procédures collectives)
   ├── BOAMP + TED (marchés publics IT : CPV 48xxx/72xxx)
   └── France Travail API v2 (offres RSSI/cyber/cloud — signal d'or)
         ↓
   raw_ingest (tampon idempotent : source + external_id unique)
         ↓
   resolve_siren → companies (SIREN, NAF, effectif, région)
         ↓
   map_signal → company_signals (type, intent_weight, observed_at, source)
         ↓
   score_icp (recalculable, sans LLM) + score_intent (decay temporel)
         ↓
   prospect_queue (triée par icp_score × intent_score)
         ↓
[Couche LLM — réservée au haut de file, plafonnée par DAILY_RESEARCH_CAP]
   analyzeAccount → contacts, signaux enrichis, hooks
```

#### Sources et leur valeur

| Source | Signal | Poids | Pourquoi |
|---|---|---|---|
| BOAMP/TED (marchés publics) | `rfp_it` | **40** | Besoin daté, budgété, décideur = pouvoir adjudicateur |
| France Travail (offres RSSI/cloud/cyber) | `recrutement_it` | **35** | SI en refonte maintenant, "pourquoi maintenant" explicite |
| web_search nominations DSI/RSSI | `nomination_dsi` | **35** | Fenêtre 100 jours, remet en jeu les fournisseurs |
| Maddyness/Les Échos (levées) | `levee` | **30** | Trésorerie → achats IT dans 3-6 mois |
| BODACC (cessions, changements d'actionnaire) | `cession` | **20** | Budget de transformation SI |
| ≥5 offres IT ouvertes | `recrutement_volume` | **20** | Croissance d'équipe IT = budgets |
| BODACC (procédure collective) | `exclusion` | **-999** | Entreprise en difficulté → exclure |

#### ICP paramétrable

```json
{
  "naf_inclus": ["64","65","86","47","35"],
  "naf_exclus": ["6201Z","6202A"],
  "effectif_min": 50, "effectif_max": 5000,
  "regions": ["11","84","93"],
  "etat_admin": "A",
  "signaux_requis_min": 1
}
```

Le `icp_score` est une somme pondérée booléenne **recalculable à tout moment** sans LLM — contrairement au `fit_score` actuel figé.

---

### 3.2 Scoring avancé à 5 sous-scores

**Objectif :** Remplacer le `fit_score` opaque par un système déterministe, explicable, recalculable sans coût LLM.

#### Formule globale

```
global = clamp((W_u·urgency + W_b·business + W_a·accessibility + W_m·it_maturity) × gate, 0, 100)
  W_u=0.35, W_b=0.25, W_a=0.18, W_m=0.12
  gate = 0.5 + 0.5 × (urgency/100)    // sans urgence, on plafonne à ×0.5
```

#### Les 5 sous-scores

**1. Score d'urgence (35%)** — Agrège les signaux datés avec décroissance temporelle.

```
freshness(signal) = exp(-ln(2)/H_type × age_mois)
  H_type : incident=3, recrutement=4, nomination=9, réglementaire=18, levée=12

contrib(signal) = base_weight × freshness × confidence_factor
  confidence_factor : verifie=1.0, partiel=0.7, non_verifie=0.4

urgency = clamp(100 × (top1 + 0.5×top2 + 0.25×top3) / 30, 0, 100)
```

Cas spécial : obligation réglementaire avec deadline future → `boost = 1 - (mois_avant_echéance/18)` (urgence croissante à l'approche).

**2. Score de maturité IT (12%)** — features extraites par le LLM (nouveau bloc `it_profile` dans le JSON de recherche) : `has_dsi`, `has_rssi`, `it_team_size_band`, `cloud_adoption`, `certifs[]`, `it_hiring_active`.

**3. Score de potentiel business (25%)** — alimenté par l'API SIRENE (NAF, effectif) et non par le LLM :
- Effectif <50→20, 50-249→45, 250-999→70, 1000-4999→88, 5000+→100
- Bonus secteur NIS2/DORA/HDS : +10
- Si effectif inconnu → estimation IA avec pénalité ×0.6 et `coverage.business="estimé"`

**4. Score d'accès (18%)** — exploite les colonnes déjà présentes mais jamais scorées :
- `email_confidence` haut +30, partiel +15, déduit +8
- Téléphone direct +20
- Niveau hiérarchique : N-2 opérationnel +25, N-1 +18, DSI grand groupe +8
- `opt-out` → hard gate, accessibility=0

**5. Score global** — moyenne pondérée renormalisée sur les sous-scores disponibles, multipliée par le gate d'urgence.

#### Exemple concret

Prospect A : RSSI adjoint, ETI 600 pers., nouveau DSI depuis 2 mois, email vérifié, échéance NIS2 dans 4 mois.
→ urgency=100, business=55, access=78, maturity=77, **global=72**

Prospect B : DSI groupe 9 000 pers., aucun signal récent, email déduit seulement.
→ urgency=0, business=100, access=16, maturity=90, **global=34**

A passe devant B — exactement le tri commercial voulu.

---

### 3.3 Sales Intelligence & Daily Queue

**Objectif :** Que Fox réponde chaque matin à "QUI je contacte, POURQUOI maintenant, QUOI je dis" — sans que Pierre ait à chercher.

#### Daily queue : maquette de l'écran cible

```
┌─ AUJOURD'HUI · 6 actions ─────────────────────────────────────────┐
│ 🔥 92  Decathlon — Appeler Marc D. (RSSI)                         │
│        POURQUOI : RFP cybersécurité publié il y a 3j (BOAMP)     │
│                   + nouveau RSSI depuis 2 mois                    │
│        [Voir brouillon triggered]  [Snooze 7j]  [Marquer fait]   │
├───────────────────────────────────────────────────────────────────┤
│ 🔥 78  Société Générale — InMail à Léa T. (Dir. Cloud)            │
│        POURQUOI : 4 postes Azure ouverts ce mois (France Travail)│
│        [Voir brouillon triggered]  [Snooze]  [Marquer fait]      │
└───────────────────────────────────────────────────────────────────┘
```

Le `reason` est composé **par template à partir des signaux typés en base** — jamais par hallucination LLM. Seuls les signaux avec `source_url` vérifié (HTTP 200) entrent dans les templates.

Le bouton "Voir brouillon triggered" appelle la route `generate` existante en **injectant le signal déclencheur** dans le prompt → l'accroche cite l'événement réel daté, pas une généralité.

#### Avantage concurrentiel vs Apollo/Cognism/Clay

| Critère | Apollo | Cognism | Fox |
|---|---|---|---|
| Volume contacts | 275M | Base vérifiée | Ciblé France IT |
| Marchés publics FR (BOAMP/TED) | ✗ | ✗ | **✓** |
| CERT-FR / incidents cyber | ✗ | ✗ | **✓** |
| NIS2/DORA par secteur | ✗ | partiel | **✓** |
| Organigramme DSI arbre | ✗ | ✗ | **✓** |
| Conformité RGPD FR native | partiel | ✓ | **✓** |
| Coût/siège | $50-100+/mois | €60-100+/mois | coût marginal LLM |

Fox gagne sur la **spécialisation IT France** et sur la **chaîne de décision DSI** — pas sur le volume.

---

### 3.4 Base des 5 000 grands comptes France

**Stratégie de construction progressive :**

1. **Liste des 5 000** : INSEE SIRENE + filtres (effectif ≥ 250 salariés, état actif, France). Gratuit, reproductible, 5 000 SIREN en une requête API.
2. **Enrichissement firmo** : NAF, tranche effectif, région, domaine web — via API Recherche d'entreprises (sans clé, gratuit).
3. **DSI/RSSI** : web_search sur nom + "DSI" / "RSSI" + LinkedIn public. Seuls les profils avec source explicite (conférence, communiqué, annuaire pro) sont conservés.
4. **Prestataires actuels** : marchés publics BOAMP/TED (secteur public) + mentions presse + offres d'emploi mentionnant les stacks actuelles (SAP, Oracle, Azure, AWS...).
5. **Projets en cours** : BOAMP/TED (lot technique), presse SI (CIO Online, Le Monde Informatique, Silicon.fr), plans de transformation annuels (rapports d'activité publics).

**Cadrage RGPD :**
- Données SIRENE/BODACC/BOAMP/INPI : open data sous licence Etalab → aucun frein.
- Données de contacts DSI/RSSI : base légale **intérêt légitime** (B2B, lien avec la fonction, sources publiques). Documenter une LIA avant l'ingestion en volume.
- Données personnelles des contacts : droit d'accès/opposition honoré via le statut opt-out existant (déjà RGPD-conforme).
- **Ne jamais ingérer** de mobile personnel, compte social privé, ou donnée non publiée professionnellement.

**Coût estimé :** L'ingestion des 5 000 comptes représente ~5 000 analyses LLM (analyzeAccount). À ~0,06€/analyse = ~300€. En lot à 10/jour (WATCH_BATCH=10) = 500 jours sans optimisation → **nécessite la file de jobs asynchrone** pour être faisable.

---

### 3.5 Automatisation autonome

**Seuils de confiance pour l'auto-validation :**

| Condition | Action |
|---|---|
| `reliability = 'verifie'` AND ≥2 sources indépendantes AND `source_url` HTTP 200 | Auto-valider (`validated=true`) |
| `reliability = 'partiel'` OR 1 seule source | Mettre en file de validation (Pierre valide) |
| `reliability = 'non_verifie'` | Proposer sans valider, Pierre doit confirmer |
| SIREN résolu + effectif SIRENE confirmé | Auto-créer le compte `companies` |
| Nomination DSI avec URL de communiqué officiel vérifiée | Auto-créer le contact (validated=false) + notification |

**Garde-fous indispensables :**

1. **Journal d'audit** : chaque action autonome logguée dans `events` avec `kind='auto_action'` et source.
2. **Quota journalier** : au maximum N créations automatiques/jour (configurable, défaut 20).
3. **Rollback par lot** : bouton "Annuler les créations auto du jour" (DELETE WHERE created_by='system' AND date=today).
4. **Revue par échantillonnage** : la daily queue inclut 2 fiches auto-validées aléatoires pour contrôle humain.
5. **Kill-switch budget** : si `ai_runs.cost_eur` du jour dépasse le budget €, arrêt de toute analyse autonome.
6. **Jamais d'écrasement** : la règle `validated=false` pour les propositions IA (déjà en place) s'applique même en mode autonome. Un humain a toujours le dernier mot.

---

### 3.6 Architecture IA multi-agents

**Agents spécialisés cibles :**

```
[Agent Collecteur] → raw_ingest (APIs gratuites, aucun LLM)
      ↓
[Agent Normaliseur] → Haiku (extraction structurée, pas de jugement, coût ×8 moins cher)
      ↓
[Agent Vérificateur] → fetch HEAD/GET des URLs sources → statut (200/404/timeout) + mention_entity
      ↓
[Agent Cartographe] → Sonnet (organigramme DSI : identité + rôle + rattachement)
      ↓
[Agent Scoreur] → JS pur, aucun LLM, computeScores(features, firmo, contact)
      ↓
[Agent Rédacteur] → Sonnet (brouillons triggered, injectés avec signaux vérifiés uniquement)
```

**Séparation extraction / jugement :**
- Pass 1 (web_search) : extraire des faits atomiques `{fait, date_iso, source_url}` — sans évaluation.
- Pass 2 (sans web_search) : raisonner UNIQUEMENT sur les faits survivants à la vérification → hooks, score_reason.

**Scoring des sources :**

| Niveau | Critère | Score |
|---|---|---|
| ✅ Officiel | .gouv.fr, rapport officiel, communiqué de presse signé | 1.0 |
| ✅ Presse établie | Les Échos, Le Monde Informatique, CIO Online, BFM | 0.85 |
| ⚠️ Blog/agrégateur | Medium, journaux spécialisés non vérifiés | 0.5 |
| ❌ Inconnu | Domaine inconnu, URL non accessible | 0.2 |

**Choix de modèle par agent :**

| Agent | Modèle | Raison |
|---|---|---|
| Normaliseur (volume) | claude-haiku-4-5 | 8× moins cher, extraction structurée simple |
| Vérificateur sources | Pas de LLM — fetch HTTP | Gratuit, déterministe |
| Cartographe organigramme | claude-sonnet-4-6 | Raisonnement complexe, contexte long |
| Scoreur | JS pur | Coût zéro, instantané, testable |
| Rédacteur brouillons | claude-sonnet-4-6 | Qualité rédactionnelle, nuance |

---

## 4. Roadmap priorisée

### ⚡ Quick Wins (semaines 1-2)

Ces actions ont le meilleur ROI immédiat. Aucune ne casse quoi que ce soit d'existant.

| # | Action | Effort | Impact | KPI |
|---|---|---|---|---|
| QW1 | **Révoquer les secrets + gitignoré batch-research.mjs** | S | Très élevé | Sécurité P0 |
| QW2 | **Cache de fraîcheur TTL 14j** (vérifier last_refreshed_at avant analyse) | S | Très élevé | -40-70% coût API |
| QW3 | **AbortController 250s + back-off recalibré** (3×20s max) | S | Élevé | Zéro timeout 300s |
| QW4 | **Valider Zod sur toutes les sorties LLM** (5 schémas, ~200 lignes) | M | Élevé | -90% erreurs 500 |
| QW5 | **Centraliser les constantes** statuts/enums dans `lib/constants.js` | S | Moyen | Maintenabilité |
| QW6 | **Rendre APP_PASSWORD obligatoire** au démarrage (throw si absent en prod) | S | Élevé | Sécurité |
| QW7 | **Persister `data.usage`** dans une table `ai_runs` (tokens + coût estimé) | M | Très élevé | Coût par lead visible |

---

### 🚀 V1 Commercialisable (mois 1-3)

La V1 est vendable à d'autres commerciaux IT indépendants ou à des équipes de 2-5 personnes.

| # | Feature | Effort | Impact | KPI |
|---|---|---|---|---|
| V1-1 | **Table `companies` avec SIREN** + résolution via recherche-entreprises.api.gouv.fr | L | Très élevé | Doublons <2% |
| V1-2 | **Table `signals` relationnelle** (sortir du JSONB) + migration backfill | L | Très élevé | Signaux requêtables |
| V1-3 | **Table `events` append-only** (timeline des statuts) | M | Très élevé | KPIs commerciaux |
| V1-4 | **Score déterministe à 5 sous-scores** (`lib/scoring.js`, aucun LLM) | L | Très élevé | Top-décile → >50% RDV |
| V1-5 | **Collecteur France Travail** (offres RSSI/cyber/cloud → company_signals) | M | Très élevé | Taux réponse ×2 sur triggered |
| V1-6 | **Collecteur BOAMP/TED** (marchés publics IT → signal rfp_it, poids 40) | M | Très élevé | Pipeline marchés publics |
| V1-7 | **Dashboard "Comptes chauds"** (5-8 cartes/jour avec signal + action) | L | Très élevé | Nb actions/jour |
| V1-8 | **Brouillons "triggered"** (injecter le signal déclencheur dans generate) | S | Très élevé | Taux de réponse |
| V1-9 | **File de jobs asynchrone** (table jobs, cron dépileur, reprise) | L | Élevé | Batch sans onglet |
| V1-10 | **Vérification URL sources** (HEAD fetch, badge "source vérifiée" en UI) | M | Très élevé | Crédibilité commerciale |

---

### 📈 V2 — Concurrencer Apollo/Cognism sur le créneau IT France (mois 4-9)

| # | Feature | Effort | Impact | KPI |
|---|---|---|---|---|
| V2-1 | **5 000 grands comptes SIREN** (ingestion SIRENE + enrichissement) | XL | Très élevé | Couverture du marché FR |
| V2-2 | **ICP paramétrable** (NAF, effectif, région — recalcul sans LLM) | M | Très élevé | Temps de qualification |
| V2-3 | **Score de chaleur avec decay temporel** (décroissance par type de signal) | M | Très élevé | Fraîcheur médiane <14j |
| V2-4 | **Agents spécialisés Haiku/Sonnet** (collecte Haiku, jugement Sonnet) | L | Élevé | Coût LLM /3 sur le volume |
| V2-5 | **Filtres/tri avancés** (score, statut, secteur, type de signal, région) | M | Élevé | Temps de ciblage |
| V2-6 | **Séquences de cadence** (next-best-action : J0 LinkedIn, J2 email, J5 call...) | L | Élevé | Nb de relances/RDV |
| V2-7 | **Scores visuels décomposés** (5 barres + explications en clair) | M | Élevé | Confiance commercial |
| V2-8 | **Schéma Zod + TypeScript progressif** | L | Moyen | Maintenabilité |
| V2-9 | **LIA documentée + registre de traitements** | S | Élevé | Conformité RGPD |
| V2-10 | **Migrations versionnées** (supabase/migrations + CI) | M | Moyen | Fiabilité des déploiements |

---

### 🏆 V3 — Plateforme de référence pour la prospection B2B IT France (mois 10-18)

| # | Feature | Effort | Impact | KPI |
|---|---|---|---|---|
| V3-1 | **Multi-tenant** (users, orgs, memberships, RLS par org_id) | XL | Très élevé | N organisations clientes |
| V3-2 | **Architecture IA multi-agents** (Collecteur/Normaliseur/Vérificateur/Scoreur/Rédacteur) | XL | Très élevé | Fiabilité données |
| V3-3 | **Séparation extraction/jugement** (2 passes LLM, anti-hallucination renforcé) | L | Élevé | % signaux vérifiés |
| V3-4 | **Web Push notifications** (compte chaud → alerte mobile) | M | Élevé | Délai réaction |
| V3-5 | **Calibration scoring par taux de conversion** (pondérations ajustées par les données réelles) | M | Élevé | Lift top-décile vs moyenne |
| V3-6 | **Organigramme interactif** (zoom, drag, export) | L | Moyen | Qualité cartographie DSI |
| V3-7 | **Harnais d'évals automatisées** (jeu gold, `npm run eval` avant chaque déploiement) | M | Moyen | Taux d'hallucination mesuré |
| V3-8 | **Intégrations** (export CRM Salesforce/HubSpot/Pipedrive) | L | Élevé | Adoption enterprise |
| V3-9 | **API partenaires** (enrichissement Clay-style, webhooks signaux) | XL | Élevé | Écosystème |

---

## 5. Architecture cible

```
┌─────────────────────────────────────────────────────────────────────┐
│                    COUCHE INGESTION (gratuite)                       │
│                                                                      │
│  INSEE SIRENE ──┐                                                    │
│  INPI/RNE ──────┤                                                    │
│  BODACC ────────┼──► raw_ingest ──► resolve_siren ──► companies      │
│  BOAMP/TED ─────┤    (idempotent)   (recherche-    (SIREN, NAF,      │
│  France Travail ┘    source+ext_id)  entreprises)  effectif, région) │
│  Presse (web_search ───────────────────────────────────────────────► │
│           Haiku)                                                     │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DATA LAYER (Supabase Postgres)                    │
│                                                                      │
│  companies ──── signals ──── contacts ──── events (timeline)         │
│      │              │            │             │                     │
│      └──── scores ──┴──── actions (daily queue) ─── ai_runs (coûts) │
│                                                                      │
│  optout (RGPD) · settings (ICP, sender) · orgs/users (V3)          │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COUCHE IA (LLM, réservée au top de file)          │
│                                                                      │
│  Agent Vérificateur (HEAD fetch URLs) ─► source.verified             │
│  Agent Cartographe (Sonnet, web_search) ─► contacts, signals typés  │
│  Agent Scoreur (JS pur, zéro LLM) ─► scores.*                       │
│  Agent Rédacteur (Sonnet, triggered) ─► brouillons datés/sourcés    │
│                                                                      │
│  Budget : ai_runs (tokens + €) → plafond configurable               │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    APP (Next.js 14, Vercel)                          │
│                                                                      │
│  /         Dashboard comptes chauds (daily queue, 5-8 cartes)        │
│  /accounts Liste triée par heat score + filtres ICP                  │
│  /accounts/[id] Fiche compte : signaux typés + timeline + org        │
│  /prospects/[id] Scores décomposés + brouillons triggered            │
│  /import   CSV enrichi SIREN + URL LinkedIn                          │
│  /settings ICP profil + sender + budget €                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Top risques & parades

### R1 — Secrets en clair (CRITIQUE — IMMÉDIAT)
`batch-research.mjs` contient la clé Supabase `service_role` et le mot de passe en clair. La `service_role` contourne la RLS = contrôle total de la base.  
**Parade :** Révoquer la clé + changer APP_PASSWORD + gitignoré (déjà fait) + ajouter gitleaks en pre-commit hook.

### R2 — RGPD : l'ingestion automatique multiplie les risques (À NUANCER)
Construire automatiquement une base de milliers de contacts B2B par moissonnage est légal sous intérêt légitime **si et seulement si** : données professionnelles publiques, lien avec la fonction du contact, opposition possible, LIA documentée, purge à 18 mois.  
**Parade :** LIA rédigée avant toute ingestion en volume, filtre optout branché en amont de l'enqueue, purge automatique des signaux > 18 mois, exclusion systématique des entreprises en procédure collective.

### R3 — Coûts non maîtrisés à l'échelle (RISQUÉ)
Le modèle LLM + web_search à 0,05-0,08€/compte ne scale pas à 5 000 comptes sans optimisation : ~300€ pour la première passe + ~300€/mois de veille complète (veille à 10/j). Sans cache et sans séparation collecte/qualification, le coût peut exploser.  
**Parade :** Dissocier collecte gratuite (APIs publiques) et qualification LLM réservée au top de file. Haiku pour le tri (8× moins cher). Cache TTL 14j. Budget € configurable avec kill-switch. La collecte SIRENE/BOAMP/France Travail est **gratuite** — seule la couche LLM coûte.

### R4 — Hallucinations non détectées en production (CRITIQUE)
Un signal inventé cité dans un email à un DSI grille le compte définitivement sur un marché IT français étroit.  
**Parade :** Vérification HEAD des URLs sources avant affichage. Badge "source vérifiée/non vérifiée" dans l'UI. Ne jamais injecter un signal non vérifié dans un brouillon généré.

### R5 — Scoring non fiable → mauvaise allocation du temps commercial
Un `fit_score` opaque et instable conduit Pierre à travailler les mauvais comptes en premier. Silencieux, donc le plus dangereux.  
**Parade :** Scoring déterministe à 5 sous-scores, recalculable sans LLM, avec `breakdown` auditable. Mesurer systématiquement le lift du top-décile vs la moyenne (taux de RDV).

### R6 — Dépendance mono-fournisseur Anthropic
L'app dépend à 100% de l'API Anthropic (modèle, web_search, disponibilité). Une panne ou un changement de tarif/modèle peut arrêter la génération.  
**Parade :** Circuit breaker (déjà partiellement implémenté via retry). Abstraire l'appel LLM derrière un module `lib/llm.js` pour faciliter un basculement. Haiku comme fallback pour les opérations non critiques.

### R7 — Batch côté client = données incomplètes sans signal d'erreur
La recherche en lot s'arrête silencieusement à la fermeture de l'onglet, avec un `catch {}` vide qui avale les erreurs.  
**Parade :** File de jobs asynchrone côté serveur (table `jobs`, cron dépileur). Pierre lance et ferme l'onglet — le travail continue et est reprenable.

---

## 7. KPIs à instrumenter

### KPIs commerciaux (priorité absolue)

| KPI | Comment le mesurer | Cible |
|---|---|---|
| **Nb de RDV qualifiés / semaine** | table `events` where kind='rdv' | +50% à 3 mois |
| **Taux de réponse emails triggered vs génériques** | events reply / actions email | ×2-3 sur triggered |
| **Fraîcheur médiane signal → contact** | median(contact_date - signal.observed_at) | < 14 jours |
| **Taux de conversion top-décile score** | % RDV pour global_score ≥ 80 | > 50% des RDV |
| **Coût LLM par lead qualifié** | ai_runs.cost_eur / nb de RDV | < 0,50€ |
| **Délai moyen de cycle qualification→RDV** | events: recherche → rdv | < 21 jours |

### KPIs data

| KPI | Comment | Cible |
|---|---|---|
| **Taux de complétude SIREN** | companies avec siren / total | > 90% |
| **% signaux à source vérifiée (HTTP 200)** | signals avec source_verified=true | > 80% |
| **Fraîcheur médiane des fiches contact** | median(today - data_date) | < 12 mois |
| **Taux de doublons comptes** | doublons détectés / total après import | < 2% |

### KPIs techniques

| KPI | Comment | Cible |
|---|---|---|
| **Taux d'analyses sans timeout** | (runs ok) / (runs total) | > 98% |
| **Coût API /jour /mois** | ai_runs.cost_eur agrégé | Budget configurable |
| **Taux d'erreurs 500 sur routes IA** | logs Vercel | < 1% |
| **Taux de réparation JSON** | callClaudeJson 2e passe / total | < 5% |

---

*Audit réalisé le 14 juin 2026 — Fox Prospect v0.1.0 (commit b820010)*  
*Dimensions auditées : 9 (architecture, sécurité, code, performance, coûts, BDD, IA, données, UX/UI)*  
*Conceptions cibles : 6 (acquisition auto, scoring avancé, sales intelligence, grands comptes, autonomie, IA multi-agents)*
