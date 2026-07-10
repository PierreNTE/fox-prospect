-- ============================================================
-- Migration V18 (Sprint 1 — Fondations) — À exécuter dans Supabase SQL Editor.
--
-- RENUMÉROTÉE de v7 en v18 lors du rebasage du 26 juillet : écrite le 10 juillet
-- sur une branche restée à part, elle portait un numéro que le schéma principal
-- avait attribué entre-temps à `migration-v7-fiche-compte.sql`. Deux v7 au
-- contenu différent auraient rendu l'ordre d'application indéchiffrable.
--
-- ⚠️ Écrite pour le schéma du 10 juillet. Elle n'a PAS été rejouée contre la base
-- actuelle, qui a reçu dix versions depuis. À relire avant application.
-- Idempotente et défensive : le schéma réel dépend de l'ordre d'exécution
-- des migrations précédentes (events v1 partitionné vs v3 non partitionné) ;
-- rien ici n'est destructif.
--
-- Apporte :
--   1. Dédoublonnage prospects + index UNIQUES (fin du dédoublonnage en RAM)
--   2. Index de tri manquants (priorités, liste filtrée)
--   3. Dédup + index unique company_signals.source_url (collecteurs sans N+1)
--   4. Table company_research (cache de recherche mutualisé par compte — S2)
--   5. RPC monthly_ai_spend() (budget en SUM SQL au lieu de charger les lignes)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Dédoublonnage prospects puis contraintes d'unicité.
--    Canonique = la fiche la plus ancienne ; les enfants (research, drafts,
--    events, briefs, ai_runs, account_contacts, scrape_results) sont re-pointés
--    avant suppression pour ne perdre aucune donnée.
-- ─────────────────────────────────────────────────────────────

create temporary table if not exists _dup_map (dup_id uuid primary key, keep_id uuid not null);

-- Doublons par email (non vide, insensible à la casse).
insert into _dup_map (dup_id, keep_id)
select p.id, k.keep_id
from public.prospects p
join (
  select lower(email) as e, (array_agg(id order by created_at asc))[1] as keep_id
  from public.prospects where coalesce(email, '') <> ''
  group by lower(email) having count(*) > 1
) k on lower(p.email) = k.e and p.id <> k.keep_id
on conflict (dup_id) do nothing;

-- Doublons par linkedin_url (non vide).
insert into _dup_map (dup_id, keep_id)
select p.id, k.keep_id
from public.prospects p
join (
  select lower(linkedin_url) as l, (array_agg(id order by created_at asc))[1] as keep_id
  from public.prospects where coalesce(linkedin_url, '') <> ''
  group by lower(linkedin_url) having count(*) > 1
) k on lower(p.linkedin_url) = k.l and p.id <> k.keep_id
on conflict (dup_id) do nothing;

-- Re-pointage des enfants vers la fiche canonique.
update public.research r set prospect_id = m.keep_id from _dup_map m where r.prospect_id = m.dup_id;
update public.drafts   d set prospect_id = m.keep_id from _dup_map m where d.prospect_id = m.dup_id;
update public.events   e set prospect_id = m.keep_id from _dup_map m where e.prospect_id = m.dup_id;
update public.ai_runs  a set prospect_id = m.keep_id from _dup_map m where a.prospect_id = m.dup_id;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='prospect_briefs') then
    update public.prospect_briefs b set prospect_id = m.keep_id from _dup_map m where b.prospect_id = m.dup_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='account_contacts' and column_name='prospect_id') then
    update public.account_contacts c set prospect_id = m.keep_id from _dup_map m where c.prospect_id = m.dup_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='scrape_results' and column_name='prospect_id') then
    update public.scrape_results s set prospect_id = m.keep_id from _dup_map m where s.prospect_id = m.dup_id;
  end if;
end $$;

delete from public.prospects p using _dup_map m where p.id = m.dup_id;
drop table if exists _dup_map;

-- Normalisation des emails historiques (l'app écrit désormais en minuscules).
update public.prospects set email = lower(email) where email <> lower(email);

-- Unicité (index partiels : les champs vides restent libres).
create unique index if not exists prospects_email_unique
  on public.prospects (lower(email)) where coalesce(email, '') <> '';
create unique index if not exists prospects_linkedin_unique
  on public.prospects (lower(linkedin_url)) where coalesce(linkedin_url, '') <> '';

-- ─────────────────────────────────────────────────────────────
-- 2. Index de tri réellement utilisés par l'app.
-- ─────────────────────────────────────────────────────────────

create index if not exists prospects_fit_score_idx
  on public.prospects (fit_score desc nulls last);
create index if not exists prospects_status_created_idx
  on public.prospects (status, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 3. company_signals : dédup par source_url puis index unique.
--    Permet aux collecteurs d'insérer en lot avec ON CONFLICT DO NOTHING
--    (fin des 2-3 requêtes par signal).
-- ─────────────────────────────────────────────────────────────

delete from public.company_signals s using public.company_signals s2
where s.source_url is not null and s.source_url <> ''
  and s.source_url = s2.source_url and s.id > s2.id;

create unique index if not exists company_signals_source_url_unique
  on public.company_signals (source_url)
  where source_url is not null and source_url <> '';

-- Rattachement par compte : les collecteurs matchent souvent un account sans
-- company_id résolu. On ajoute account_id pour ne plus perdre ces signaux.
alter table public.company_signals
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;
alter table public.company_signals
  alter column company_id drop not null;

create index if not exists company_signals_account_idx
  on public.company_signals (account_id, observed_at desc) where account_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 4. Cache de recherche mutualisé par compte (Sprint 2).
--    Une extraction web par ENTREPRISE (TTL en code), partagée par tous les
--    prospects du compte — le levier coût n°1 de l'audit.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.company_research (
  account_id      uuid primary key references public.accounts(id) on delete cascade,
  facts           jsonb not null default '[]',
  company_context text default '',
  sources         jsonb not null default '[]',
  model           text default '',
  updated_at      timestamptz not null default now()
);

alter table public.company_research enable row level security;

comment on table public.company_research is
  'Cache d''extraction web par compte (faits sourcés). Partagé entre tous les prospects du compte, TTL géré en code (FRESHNESS_TTL_DAYS).';

-- ─────────────────────────────────────────────────────────────
-- 5. Budget mensuel en SQL (remplace le chargement de toutes les lignes).
-- ─────────────────────────────────────────────────────────────

create or replace function public.monthly_ai_spend()
returns numeric
language sql
stable
as $$
  select coalesce(sum(cost_eur), 0)
  from public.ai_runs
  where created_at >= date_trunc('month', now() at time zone 'utc');
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. PLAN DE FUSION accounts → companies (exécution : Sprint 5).
--    Non exécuté ici : nécessite un backfill SIREN sur données réelles.
--    Étapes prévues :
--      a. Backfill accounts.company_id via resolveSiren (job JS, par lots)
--      b. prospects.company_id = accounts.company_id (UPDATE de bascule)
--      c. Basculer les FK applicatives (account_id → company_id)
--      d. create view accounts_legacy as select ... from companies
--      e. drop table accounts (après 2 semaines de vue de compat)
-- ─────────────────────────────────────────────────────────────
