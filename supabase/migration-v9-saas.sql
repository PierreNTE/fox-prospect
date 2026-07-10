-- ============================================================
-- Migration V9 (Sprint 4 — Fondations SaaS multi-tenant)
-- À exécuter dans Supabase SQL Editor. Idempotente.
--
-- Pose le socle multi-tenant AVANT que le volume rende le backfill pénible :
--   1. orgs + org_members (rattachés à auth.users — schéma auth natif Supabase)
--   2. org_id sur toutes les tables métier, backfillé vers une org par défaut
--   3. Policies RLS par org — ACTIVES mais inertes tant que l'app passe par
--      service_role (qui contourne la RLS). Le jour où le front bascule sur
--      Supabase Auth (clé anon + session), l'isolation est déjà en place.
--   4. Purge RGPD conservatrice (prospects opt-out > 36 mois ; la liste
--      d'opposition `optout` est CONSERVÉE — c'est elle l'obligation légale)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Organisations et membres.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.orgs (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  monthly_budget_eur numeric(10,2) not null default 15,
  daily_research_cap int not null default 50,
  created_at         timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

-- Org par défaut (idempotent : une seule ligne nommée 'default').
insert into public.orgs (name)
select 'default'
where not exists (select 1 from public.orgs where name = 'default');

-- ─────────────────────────────────────────────────────────────
-- 2. org_id sur les tables métier + backfill vers l'org par défaut.
--    (companies reste un référentiel public partagé — pas d'org_id : les
--    données SIRENE sont les mêmes pour tous les tenants.)
-- ─────────────────────────────────────────────────────────────

do $$
declare
  default_org uuid;
  t text;
begin
  select id into default_org from public.orgs where name = 'default' limit 1;

  foreach t in array array[
    'prospects','accounts','research','drafts','events','ai_runs',
    'company_signals','company_research','saved_views','prospect_briefs',
    'jobs','optout','settings','account_contacts'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I add column if not exists org_id uuid references public.orgs(id)', t);
      execute format('update public.%I set org_id = %L where org_id is null', t, default_org);
    end if;
  end loop;
end $$;

create index if not exists prospects_org_idx on public.prospects (org_id);
create index if not exists accounts_org_idx  on public.accounts (org_id);
create index if not exists events_org_idx    on public.events (org_id);
create index if not exists ai_runs_org_idx   on public.ai_runs (org_id);

-- ─────────────────────────────────────────────────────────────
-- 3. Policies RLS par org (rôle authenticated — inertes avec service_role).
--    Un membre voit les lignes de ses orgs ; jamais celles des autres.
-- ─────────────────────────────────────────────────────────────

create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'prospects','accounts','research','drafts','events','ai_runs',
    'company_signals','company_research','saved_views','prospect_briefs',
    'jobs','optout','settings','account_contacts'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('drop policy if exists org_isolation on public.%I', t);
      execute format(
        'create policy org_isolation on public.%I for all to authenticated
           using (org_id in (select public.user_org_ids()))
           with check (org_id in (select public.user_org_ids()))', t);
    end if;
  end loop;
end $$;

-- Un membre voit son org et ses co-membres.
drop policy if exists org_read on public.orgs;
create policy org_read on public.orgs for select to authenticated
  using (id in (select public.user_org_ids()));

drop policy if exists members_read on public.org_members;
create policy members_read on public.org_members for select to authenticated
  using (org_id in (select public.user_org_ids()));

-- ─────────────────────────────────────────────────────────────
-- 4. Purge RGPD conservatrice — appelée par le cron quotidien.
--    Supprime les FICHES opt-out anciennes (36 mois) ; la liste d'opposition
--    `optout` (emails) est conservée : c'est elle qui bloque tout ré-import.
-- ─────────────────────────────────────────────────────────────

create or replace function public.purge_optout_prospects()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.prospects
  where do_not_contact = true
    and created_at < now() - interval '36 months';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- ÉTAPE SUIVANTE (hors SQL — configuration Supabase dashboard) :
--   a. Activer Supabase Auth (email OTP) + créer le premier user
--   b. insert into org_members (org_id, user_id, role) values (default, <uid>, 'owner')
--   c. Basculer le front sur la clé anon + session Supabase (remplace
--      APP_PASSWORD/middleware) — les policies ci-dessus prennent le relais.
-- ─────────────────────────────────────────────────────────────
