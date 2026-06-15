-- ============================================================
-- Migration Quick Wins — à exécuter dans Supabase SQL Editor
-- ============================================================

-- QW7 — Table ai_runs : comptabilité de chaque appel LLM.
-- Permet de connaître le coût réel par lead, par route et par jour.
create table if not exists public.ai_runs (
  id               bigint generated always as identity primary key,
  route            text not null,          -- 'research'|'analyze'|'enrich'|'import-linkedin'|'generate'
  prospect_id      uuid references public.prospects(id) on delete set null,
  account_id       uuid references public.accounts(id)  on delete set null,
  input_tokens     int  not null default 0,
  output_tokens    int  not null default 0,
  web_search_count int  not null default 0,
  cost_eur         numeric(10,5) not null default 0,
  created_at       timestamptz  not null default now()
);

alter table public.ai_runs enable row level security;

create index if not exists ai_runs_created_idx  on public.ai_runs (created_at desc);
create index if not exists ai_runs_route_idx    on public.ai_runs (route);
create index if not exists ai_runs_prospect_idx on public.ai_runs (prospect_id) where prospect_id is not null;
create index if not exists ai_runs_account_idx  on public.ai_runs (account_id)  where account_id  is not null;

comment on table public.ai_runs is 'Journal de chaque appel LLM : route, tokens, coût estimé.';
