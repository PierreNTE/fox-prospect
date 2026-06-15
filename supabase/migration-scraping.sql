-- ============================================================
-- Migration SCRAPING — file de jobs + résultats du worker GitHub Actions.
-- À exécuter dans Supabase SQL Editor. Idempotente (if not exists partout).
-- Purement additive : ne modifie aucune table existante.
-- ============================================================

-- ── File de jobs de scraping ─────────────────────────────────────────────────
-- Alimentée par l'app (POST /api/scrape/enqueue), consommée par worker.py.
-- Le worker fait progresser status/progress/stats au fil de l'eau ; l'app lit
-- (polling) pour afficher la progression en direct.
create table if not exists public.scrape_jobs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('discover', 'enrich', 'discover_and_enrich')),
  params      jsonb not null default '{}'::jsonb,   -- { account_id?, company, limit, roles? }
  status      text not null default 'pending'
              check (status in ('pending', 'running', 'done', 'error')),
  progress    int  not null default 0,              -- 0-100
  stats       jsonb not null default '{}'::jsonb,   -- { found, enriched, blocked }
  error       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);

-- FIFO : on prend les 'pending' les plus anciens.
create index if not exists scrape_jobs_status_idx on public.scrape_jobs (status, created_at);

-- ── Résultats (contacts trouvés/enrichis) ────────────────────────────────────
-- account_id : rattachement au compte ciblé (sert au domaine d'enrichissement et
-- à la promotion en prospect). prospect_id : renseigné quand le contact a été
-- promu/qualifié (évite la double-promotion). source : traçabilité conformité.
create table if not exists public.scrape_results (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid references public.scrape_jobs(id) on delete cascade,
  account_id       uuid references public.accounts(id)   on delete set null,
  prospect_id      uuid references public.prospects(id)  on delete set null,
  full_name        text,
  title            text,
  company          text,
  linkedin_url     text,
  email            text,
  email_confidence text,
  email_source     text,
  source           text,
  raw              jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists scrape_results_job_idx      on public.scrape_results (job_id, created_at desc);
create index if not exists scrape_results_linkedin_idx on public.scrape_results (linkedin_url);
create index if not exists scrape_results_email_idx    on public.scrape_results (email);

-- ── Sécurité (RLS) ───────────────────────────────────────────────────────────
-- Cohérent avec l'existant : RLS activée, aucune policy → accès réservé à la clé
-- service_role (worker GitHub + routes API Next.js). Jamais d'accès client direct.
alter table public.scrape_jobs    enable row level security;
alter table public.scrape_results enable row level security;

-- Note : les events de scraping (création/complétion d'un job) sont journalisés
-- côté app/worker avec kind = 'auto_action' (déjà autorisé), pour ne pas toucher
-- la contrainte CHECK de la table events. Aucun ALTER ici.