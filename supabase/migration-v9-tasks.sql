-- Fox Prospect — migration v9 : agenda / tâches (FV3).
-- À exécuter dans le SQL Editor de Supabase (idempotent : "if not exists").
--
-- Distinct de prospects.follow_up_at (le plan de relance COURANT d'un prospect,
-- qui pilote la NBA et le cockpit) : `tasks` est l'agenda général — todos datés,
-- éventuellement rattachés à un prospect et/ou un compte, cochables.

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  kind        text not null default 'autre'
              check (kind in ('appel','email','linkedin','rdv','relance','autre')),
  due_date    date,
  done        boolean not null default false,
  done_at     timestamptz,
  prospect_id uuid references public.prospects(id) on delete cascade,
  account_id  uuid references public.accounts(id)  on delete cascade,
  notes       text default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.tasks enable row level security;

-- File des tâches ouvertes, les plus urgentes d'abord (échéance ascendante).
create index if not exists tasks_open_due_idx on public.tasks (due_date asc) where done = false;
create index if not exists tasks_prospect_idx on public.tasks (prospect_id);
create index if not exists tasks_account_idx  on public.tasks (account_id);

comment on table public.tasks is 'Agenda commercial : tâches datées, éventuellement rattachées à un prospect/compte. Séparé de prospects.follow_up_at (plan de relance courant).';
