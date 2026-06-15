-- ============================================================
-- Migration V1 — Schéma cible pour la plateforme commerciale
-- À exécuter APRÈS migration-quickwins.sql
-- Nécessite l'extension pg_trgm pour la recherche floue sur les noms.
-- ============================================================

-- Extension pour la recherche par similarité de nom.
create extension if not exists pg_trgm;

-- ─────────────────────────────────────────────────────────────
-- 1. Référentiel entreprises (SIREN = clé pivot universelle)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.companies (
  id              bigint generated always as identity primary key,
  siren           char(9)  unique,          -- identifiant INSEE officiel
  domain          text     unique,          -- domaine web canonique (sans www)
  name            text     not null,
  naf_code        char(5),                  -- ex. 6202A
  naf_label       text,
  effectif_min    int,
  effectif_max    int,
  effectif_tranche text,                    -- ex. '250-499'
  region_code     char(2),
  commune         text,
  categorie       text check (categorie in ('PME','ETI','GE','TPE')),
  etat_admin      char(1) default 'A',      -- A=actif / C=cessé
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.companies enable row level security;

-- Index de recherche floue sur le nom (lower seul, sans unaccent qui n'est pas IMMUTABLE).
create index if not exists companies_name_trgm  on public.companies using gin (lower(name) gin_trgm_ops);
create index if not exists companies_naf_idx    on public.companies (naf_code);
create index if not exists companies_region_idx on public.companies (region_code);

comment on table public.companies is 'Référentiel entreprises pivotées sur le SIREN (INSEE). Alimenté par recherche-entreprises.api.gouv.fr.';

-- ─────────────────────────────────────────────────────────────
-- 2. Rattacher les tables existantes à companies
-- ─────────────────────────────────────────────────────────────

alter table public.accounts
  add column if not exists company_id bigint references public.companies(id) on delete set null;

alter table public.prospects
  add column if not exists company_id bigint references public.companies(id) on delete set null;

-- ─────────────────────────────────────────────────────────────
-- 3. Signaux d'achat datés et requêtables (exit jsonb accounts.signals)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.company_signals (
  id          bigint generated always as identity primary key,
  company_id  bigint not null references public.companies(id) on delete cascade,
  contact_id  uuid   references public.account_contacts(id)  on delete set null,
  type        text   not null check (type in (
                'recrutement','levee','projet','incident','nomination',
                'reglementaire','prise_de_parole','rfp_it','autre'
              )),
  detail      text   not null,
  observed_at date   not null,
  source_url  text,
  source_verified boolean default false,
  confidence  numeric(3,2) default 1.0 check (confidence between 0 and 1),
  base_weight int    default 0,
  status      text   not null default 'nouveau'
              check (status in ('nouveau','traité','écarté')),
  created_at  timestamptz not null default now()
);

alter table public.company_signals enable row level security;

create index if not exists signals_company_fresh on public.company_signals (company_id, observed_at desc);
create index if not exists signals_unread        on public.company_signals (observed_at desc) where status = 'nouveau';
create index if not exists signals_type_idx      on public.company_signals (type);

comment on table public.company_signals is 'Signaux d''achat datés par entreprise — source de vérité pour le scoring d''urgence.';

-- ─────────────────────────────────────────────────────────────
-- 4. Timeline d'événements (KPIs commerciaux)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.events (
  id          bigint generated always as identity,
  prospect_id uuid references public.prospects(id) on delete cascade,
  company_id  bigint references public.companies(id),
  kind        text not null check (kind in (
    'status_change','email_sent','email_opened','reply','call','rdv',
    'signal_detected','auto_action','opt_out'
  )),
  from_status text,
  to_status   text,
  note        text,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create table if not exists public.events_2026
  partition of public.events for values from ('2026-01-01') to ('2027-01-01');
create table if not exists public.events_2027
  partition of public.events for values from ('2027-01-01') to ('2028-01-01');

alter table public.events enable row level security;

create index if not exists events_prospect_idx on public.events (prospect_id, occurred_at desc);
create index if not exists events_kind_idx     on public.events (kind, occurred_at desc);

comment on table public.events is 'Timeline append-only des interactions commerciales. Base des KPIs (taux de réponse, délai de cycle).';

-- ─────────────────────────────────────────────────────────────
-- 5. Scores décomposés (exit fit_score opaque)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.scores (
  prospect_id         uuid primary key references public.prospects(id) on delete cascade,
  global_score        smallint check (global_score        between 0 and 100),
  urgency_score       smallint check (urgency_score       between 0 and 100),
  business_score      smallint check (business_score      between 0 and 100),
  accessibility_score smallint check (accessibility_score between 0 and 100),
  it_maturity_score   smallint check (it_maturity_score   between 0 and 100),
  breakdown           jsonb    not null default '{}'::jsonb,
  weights_version     text     not null default 'v1',
  computed_at         timestamptz not null default now()
);

alter table public.scores enable row level security;

comment on table public.scores is 'Scores décomposés (5 dimensions) calculés de façon déterministe — auditables sans LLM.';

-- ─────────────────────────────────────────────────────────────
-- 6. File de jobs asynchrone (exit batch côté client)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.jobs (
  id          bigint generated always as identity primary key,
  kind        text  not null check (kind in ('analyze_account','research_prospect','enrich_prospect')),
  payload     jsonb not null default '{}'::jsonb,
  status      text  not null default 'pending'
              check (status in ('pending','running','done','error')),
  attempts    int   not null default 0,
  last_error  text,
  scheduled_at timestamptz not null default now(),
  started_at  timestamptz,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.jobs enable row level security;

create index if not exists jobs_pending_idx on public.jobs (scheduled_at asc) where status = 'pending';

comment on table public.jobs is 'File de jobs asynchrone — dépilée par le cron. Rend le batch indépendant de l''onglet navigateur.';
