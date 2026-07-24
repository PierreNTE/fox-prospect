-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION v12 — Module de veille commerciale
--
-- Idempotente : réexécutable sans effet de bord.
-- À appliquer dans l'éditeur SQL Supabase, en une seule fois.
--
-- Principes retenus (livrables 2-3) :
--  · on ÉTEND company_signals, on ne crée pas une seconde table de signaux ;
--  · les embeddings vivent dans une table SÉPARÉE, pour rendre la purge à
--    12 mois triviale — c'est le seul poste à croissance illimitée sous le
--    palier gratuit de 500 Mo ;
--  · une table de staging (veille_documents) conserve aussi les documents
--    écartés : sans eux, impossible de mesurer si le filtre est trop sévère ;
--  · le pipeline tournant sur GitHub Actions sans orchestrateur, la
--    déduplication et la reprise sont portées par le SCHÉMA (unicité +
--    statut par étage), pas par le code.
--
-- RLS activée partout, aucune policy : seul le service_role accède aux
-- données, comme pour le reste du schéma.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. Extension pgvector
-- ─────────────────────────────────────────────────────────────
-- halfvec (fp16) exige pgvector >= 0.7 ; Supabase fournit 0.8.x.
-- Divise par deux l'empreinte mémoire des vecteurs, sans perte mesurable
-- de qualité de rappel sur des textes courts.

create extension if not exists vector;


-- ─────────────────────────────────────────────────────────────
-- 2. companies — identifiants hors France
-- ─────────────────────────────────────────────────────────────
-- Le référentiel est pivoté sur le SIREN, donc franco-centré. Le MVP couvre
-- FR / DE / UK : on ajoute le LEI (pivot international GLEIF) et le numéro de
-- registre national. `siren` reste unique mais nullable pour les entités
-- étrangères, qui se rattachent par `domain` (déjà unique) ou par LEI.

alter table public.companies
  add column if not exists country_code    char(2) not null default 'FR',
  add column if not exists lei             char(20),
  add column if not exists reg_number      text,
  add column if not exists reg_source      text;

comment on column public.companies.lei is
  'Legal Entity Identifier (GLEIF). Pivot de rapprochement inter-pays, le plus fiable.';
comment on column public.companies.reg_number is
  'Numéro de registre national : company number (UK), Handelsregisternummer (DE).';

-- Unicité du LEI quand il est renseigné (index partiel : les NULL restent libres).
create unique index if not exists companies_lei_uidx
  on public.companies (lei) where lei is not null;

create index if not exists companies_country_idx
  on public.companies (country_code);


-- ─────────────────────────────────────────────────────────────
-- 3. veille_sources — configuration des sources
-- ─────────────────────────────────────────────────────────────
-- La configuration vit en BASE et non dans le code : ajouter une source ne
-- doit pas demander un déploiement. C'est aussi le prérequis de la trajectoire
-- SaaS — des sources par utilisateur seront un jeu de lignes.

create table if not exists public.veille_sources (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in (
                  'rss',        -- presse, blogs, communiqués
                  'ted',        -- Tenders Electronic Daily (UE)
                  'boamp',      -- marchés publics France
                  'fts',        -- Find a Tender / Contracts Finder (UK)
                  'emploi',     -- France Travail, Adzuna
                  'registre',   -- GLEIF, Companies House, recherche-entreprises
                  'web'         -- page à crawler (pages carrières, salle de presse)
                )),
  label         text not null,
  url           text,
  country_code  char(2),
  config        jsonb not null default '{}'::jsonb,   -- filtres : codes CPV, mots-clés, seuils
  enabled       boolean not null default true,

  -- Curseur d'incrémentalité (date, identifiant ou page selon la source).
  -- « cursor » est un mot réservé PostgreSQL : d'où sync_cursor.
  sync_cursor   text,

  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);

comment on table public.veille_sources is
  'Sources de veille. Modifiable sans déploiement ; sert de curseur d''incrémentalité.';

create index if not exists veille_sources_active_idx
  on public.veille_sources (kind, country_code) where enabled;


-- ─────────────────────────────────────────────────────────────
-- 4. veille_documents — staging
-- ─────────────────────────────────────────────────────────────
-- Tout ce qui est collecté atterrit ici, RETENU OU ÉCARTÉ. Deux raisons :
--  · mesurer le taux de rejet du filtre lexical (un filtre qu'on ne peut pas
--    évaluer se dégrade en silence) ;
--  · rejouer une classification sans recollecter — ce qu'un orchestrateur
--    offrirait et que GitHub Actions n'offre pas.
--
-- CONFORMITÉ : `excerpt` est un EXTRAIT COURT, jamais l'article intégral.
-- Le texte de presse est protégé par le droit d'auteur ; on conserve l'URL,
-- le titre, un extrait et l'embedding — pas l'œuvre.

create table if not exists public.veille_documents (
  id            bigint generated always as identity primary key,
  source_id     bigint references public.veille_sources(id) on delete set null,

  url           text not null,
  -- Empreinte SHA-256 de l'URL normalisée (sans utm_*, sans fragment, en
  -- minuscules). La déduplication est une CONTRAINTE, pas du code applicatif :
  -- relancer le passage quotidien deux fois ne crée jamais de doublon.
  url_hash      text not null unique,

  title         text not null default '',
  excerpt       text not null default '',
  lang          char(2),
  published_at  date,

  -- Charge utile structurée des sources qui en fournissent une (TED, emploi).
  -- Évite de reparser : les codes CPV et montants sont déjà là.
  raw           jsonb not null default '{}'::jsonb,

  -- Statut par étage : porte la reprise sur incident.
  status        text not null default 'collecte' check (status in (
                  'collecte',   -- récupéré, pas encore extrait
                  'extrait',    -- contenu et métadonnées extraits
                  'ecarte',     -- rejeté par le filtre (conservé pour mesure)
                  'classe',     -- catégorie et ligne de produit déterminées
                  'rattache',   -- signal créé
                  'erreur'
                )),
  reject_reason text,

  collected_at  timestamptz not null default now(),
  processed_at  timestamptz
);

comment on table public.veille_documents is
  'Staging de la collecte. Conserve aussi les documents écartés, pour mesurer le filtre.';
comment on column public.veille_documents.excerpt is
  'Extrait court uniquement. Ne JAMAIS stocker le texte intégral d''un article de presse.';

-- File de reprise : les documents qu'il reste à traiter, les plus anciens d'abord.
create index if not exists veille_documents_todo_idx
  on public.veille_documents (collected_at asc)
  where status in ('collecte', 'extrait', 'classe');

create index if not exists veille_documents_source_idx
  on public.veille_documents (source_id, collected_at desc);

create index if not exists veille_documents_published_idx
  on public.veille_documents (published_at desc nulls last);

-- Recherche plein texte multilingue. Configuration « simple » volontairement :
-- un dictionnaire français appliqué à un texte allemand dégrade le résultat,
-- et la recherche sémantique porte déjà la compréhension du sens.
create index if not exists veille_documents_fts_idx
  on public.veille_documents
  using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(excerpt, '')));


-- ─────────────────────────────────────────────────────────────
-- 5. company_signals — extension
-- ─────────────────────────────────────────────────────────────
-- La table existe depuis v1 avec la bonne granularité. On l'enrichit de la
-- dimension produit (Dell CSG / ISG) et de la traçabilité du rapprochement.

-- CORRECTION D'ARCHITECTURE, motivée par l'état réel de la base.
-- `companies` et `company_signals` sont créées depuis v1 mais VIDES, et aucun
-- compte ne porte de company_id : le référentiel n'a jamais été alimenté.
-- Faire dépendre la veille d'un company_id obligatoire imposerait donc un
-- backfill préalable des 61 comptes — une dépendance dure pour aucun gain.
--
-- On rend company_id NULLABLE et on ajoute un lien DIRECT vers accounts :
--  · l'unité de travail du CRM est le compte (uuid), c'est lui que l'interface
--    affiche et sur lequel porte la timeline ;
--  · `companies` reste la couche d'identité et de firmographie (SIREN, LEI,
--    NAF, effectifs), précieuse mais hors du chemin critique ;
--  · un signal reste exploitable même quand la résolution firmographique
--    échoue — ce qui sera fréquent en Allemagne, faute de registre ouvert.

alter table public.company_signals
  alter column company_id drop not null;

alter table public.company_signals
  add column if not exists account_id       uuid references public.accounts(id) on delete cascade,
  add column if not exists document_id      bigint references public.veille_documents(id) on delete set null,
  add column if not exists title            text,
  add column if not exists lang             char(2),
  add column if not exists country_code     char(2),

  -- Dimension produit, orthogonale au type : « projet » peut être CSG
  -- (renouvellement de parc) ou ISG (datacenter). Croiser les deux dans un
  -- seul champ rendrait le scoring inexploitable.
  add column if not exists product_line     text check (product_line in ('csg','isg','both','none')),

  -- Traçabilité du rattachement. Un rapprochement par similarité de nom ne
  -- doit JAMAIS être présenté avec la même assurance qu'un rapprochement par
  -- identifiant officiel : la méthode est stockée pour être affichée.
  add column if not exists match_method     text check (match_method in (
                                              'lei','siren','registre','domaine','nom','manuel')),
  add column if not exists match_confidence numeric(3,2) check (match_confidence between 0 and 1),

  -- RGPD : la personne citée dans un signal de nomination est isolée dans une
  -- colonne dédiée, et non noyée dans `detail`. C'est ce qui rend le droit
  -- d'opposition applicable (voir table optout).
  add column if not exists person_name      text;

comment on column public.company_signals.product_line is
  'Affinité portefeuille Dell : csg (poste de travail), isg (datacenter), both, none.';
comment on column public.company_signals.match_method is
  'Méthode de rattachement au compte. Affichée dans l''interface : « nom » n''est pas « lei ».';
comment on column public.company_signals.person_name is
  'Personne citée (nominations). Isolée pour rendre le droit d''opposition RGPD applicable.';

-- Le type gagne « concurrence » : mouvement d'un concurrent chez un compte
-- cible, notamment via les avis d'ATTRIBUTION TED qui nomment le titulaire.
-- Drop puis add : idempotent, et aucune ligne existante ne peut violer un
-- check qu'on ne fait qu'élargir.
alter table public.company_signals
  drop constraint if exists company_signals_type_check;

alter table public.company_signals
  add constraint company_signals_type_check check (type in (
    'recrutement','levee','projet','incident','nomination',
    'reglementaire','prise_de_parole','rfp_it',
    'concurrence',   -- nouveau : HPE / Lenovo / HP Inc. chez un compte suivi
    'autre'
  ));

-- Un signal orphelin — rattaché ni à un compte ni à une entreprise — n'a
-- aucune valeur : il ne s'afficherait nulle part.
alter table public.company_signals
  drop constraint if exists company_signals_rattachement_chk;

alter table public.company_signals
  add constraint company_signals_rattachement_chk
  check (account_id is not null or company_id is not null);

-- Accès principal de la fiche compte : les signaux d'un compte, du plus récent
-- au plus ancien.
create index if not exists signals_account_fresh_idx
  on public.company_signals (account_id, observed_at desc)
  where account_id is not null;

create index if not exists signals_product_line_idx
  on public.company_signals (product_line, observed_at desc)
  where product_line is not null;

create index if not exists signals_document_idx
  on public.company_signals (document_id);

-- Un même document ne doit produire qu'un signal par compte, même si le
-- passage quotidien est relancé. C'est la garantie d'idempotence du dernier
-- étage du pipeline.
create unique index if not exists signals_doc_account_uidx
  on public.company_signals (document_id, account_id)
  where document_id is not null and account_id is not null;


-- ─────────────────────────────────────────────────────────────
-- 6. signal_embeddings — vecteurs, table séparée
-- ─────────────────────────────────────────────────────────────
-- BGE-M3 produit 1024 dimensions. En halfvec : ~2 Ko par vecteur, ~3 Ko avec
-- l'index HNSW. À 150 signaux/jour sur une fenêtre de 12 mois → ~55 000
-- vecteurs, ~165 Mo : sous le palier gratuit de 500 Mo, avec de la réserve.
--
-- SÉPARÉE de company_signals à dessein : purger l'historique vectoriel ne doit
-- jamais toucher aux signaux eux-mêmes. On perd la recherche sémantique sur
-- l'ancien, jamais l'historique.

create table if not exists public.signal_embeddings (
  signal_id   bigint primary key references public.company_signals(id) on delete cascade,
  embedding   halfvec(1024) not null,
  model       text not null default 'bge-m3',
  created_at  timestamptz not null default now()
);

comment on table public.signal_embeddings is
  'Vecteurs des signaux. Table séparée pour permettre une purge glissante à 12 mois.';

-- HNSW plutôt qu'IVFFlat : pas de phase d'entraînement, qualité de rappel
-- stable quand la table grossit par petits incréments quotidiens.
create index if not exists signal_embeddings_hnsw_idx
  on public.signal_embeddings
  using hnsw (embedding halfvec_cosine_ops);

create index if not exists signal_embeddings_age_idx
  on public.signal_embeddings (created_at);


-- ─────────────────────────────────────────────────────────────
-- 7. pipeline_runs — supervision
-- ─────────────────────────────────────────────────────────────
-- On surveille les VOLUMES autant que les erreurs. Le mode de défaillance le
-- plus probable d'un module de veille n'est pas l'exception : c'est une source
-- qui change de format et renvoie zéro résultat, silencieusement.

create table if not exists public.pipeline_runs (
  id            bigint generated always as identity primary key,
  run_ref       text,        -- identifiant d'exécution GitHub Actions
  source_id     bigint references public.veille_sources(id) on delete set null,
  stage         text not null,
  collected     int not null default 0,
  kept          int not null default 0,
  signals       int not null default 0,
  llm_calls     int not null default 0,
  duration_ms   int,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

comment on table public.pipeline_runs is
  'Journal d''exécution du pipeline. Sert à détecter les sources devenues muettes.';

create index if not exists pipeline_runs_recent_idx
  on public.pipeline_runs (started_at desc);

create index if not exists pipeline_runs_source_idx
  on public.pipeline_runs (source_id, started_at desc);


-- ─────────────────────────────────────────────────────────────
-- 8. RLS
-- ─────────────────────────────────────────────────────────────
-- Activée sans policy : le service_role la contourne, tout autre rôle est
-- refusé. Même convention que le reste du schéma.

alter table public.veille_sources   enable row level security;
alter table public.veille_documents enable row level security;
alter table public.signal_embeddings enable row level security;
alter table public.pipeline_runs    enable row level security;


-- ─────────────────────────────────────────────────────────────
-- 9. Purge glissante des vecteurs (optionnel)
-- ─────────────────────────────────────────────────────────────
-- Ne s'applique QUE si l'extension pg_cron est activée sur le projet
-- (Database → Extensions dans le tableau de bord Supabase). Sans elle, la
-- purge peut être déclenchée par le pipeline quotidien — voir la fonction
-- ci-dessous, qui est utilisable dans les deux cas.

-- Le paramètre est préfixé p_ : `make_interval(months => months)` rendrait la
-- référence ambiguë entre l'argument nommé et la variable plpgsql.
create or replace function public.purge_signal_embeddings(p_months int default 12)
returns int
language plpgsql
as $$
declare
  removed int;
begin
  delete from public.signal_embeddings
  where created_at < now() - make_interval(months => p_months);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.purge_signal_embeddings is
  'Supprime les vecteurs au-delà de N mois. Les signaux sont conservés intacts.';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-signal-embeddings')
      where exists (select 1 from cron.job where jobname = 'purge-signal-embeddings');
    perform cron.schedule(
      'purge-signal-embeddings',
      '0 3 * * 0',                                  -- dimanche 03:00 UTC
      $cron$select public.purge_signal_embeddings(12)$cron$
    );
    raise notice 'purge hebdomadaire des vecteurs planifiée via pg_cron';
  else
    raise notice 'pg_cron absent : appeler purge_signal_embeddings(12) depuis le pipeline';
  end if;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 10. Sources initiales du MVP
-- ─────────────────────────────────────────────────────────────
-- Insérées seulement si absentes, pour rester rejouable.
-- Les identifiants et clés d'API restent dans les variables d'environnement :
-- cette table ne contient JAMAIS de secret.

insert into public.veille_sources (kind, label, url, country_code, config)
select v.kind, v.label, v.url, v.country_code, v.config::jsonb
from (values
  -- Les codes CPV doivent être COMPLETS : l'API TED rejette un préfixe comme
  -- « 72 ». Vérifié contre l'API de production.
  ('ted',   'TED — avis de marché IT',      'https://api.ted.europa.eu/v3/notices/search', null,
   '{"cpv_codes":["30200000","30213000","30233000","48000000","48800000","48820000","72000000","72500000"],"notice_types":["cn-standard"]}'),
  ('ted',   'TED — avis d''attribution',    'https://api.ted.europa.eu/v3/notices/search', null,
   '{"cpv_codes":["30200000","30213000","30233000","48000000","48800000","48820000","72000000","72500000"],"notice_types":["can-standard"],"veille_concurrentielle":true}'),
  ('boamp', 'BOAMP — marchés IT',           'https://api.boamp.fr',                        'FR', '{}'),
  ('fts',   'Find a Tender — UK',           'https://www.find-tender.service.gov.uk',      'GB', '{}'),
  ('emploi','France Travail — offres IT',   null,                                          'FR',
   '{"rome":["M1805","M1802","M1810"]}'),
  ('emploi','Adzuna — DE / UK',             'https://api.adzuna.com',                      null,
   '{"countries":["de","gb"],"category":"it-jobs"}'),
  ('registre','GLEIF — LEI',                'https://api.gleif.org/api/v1',                null, '{}'),
  ('registre','Companies House — UK',       'https://api.company-information.service.gov.uk','GB','{}')
) as v(kind, label, url, country_code, config)
where not exists (
  select 1 from public.veille_sources s where s.label = v.label
);


-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification post-migration (à exécuter séparément) :
--
--   select extname, extversion from pg_extension where extname = 'vector';
--   select count(*) from public.veille_sources where enabled;
--   select column_name from information_schema.columns
--     where table_name = 'company_signals' and column_name = 'product_line';
-- ═══════════════════════════════════════════════════════════════════════════
