-- Fox Prospect — migration v10 : opportunités / pipeline de vente (FV2, Jalon 2).
-- À exécuter dans le SQL Editor de Supabase (idempotent : "if not exists").
--
-- L'affaire (deal) est la brique qui manquait : jusqu'ici le « funnel » n'était
-- que le statut d'un CONTACT. Ici on suit un montant, une étape, une probabilité
-- et une date de closing → base du pipeline et des prévisions.

create table if not exists public.opportunities (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id)  on delete cascade,
  prospect_id   uuid          references public.prospects(id) on delete set null,
  title         text not null,
  stage         text not null default 'qualification'
                check (stage in ('qualification','decouverte','proposition','negociation','gagne','perdu')),
  amount_eur    numeric(12,2),
  probability   int check (probability between 0 and 100),
  expected_close_date date,
  notes         text default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.opportunities enable row level security;

create index if not exists opp_account_idx on public.opportunities (account_id);
create index if not exists opp_open_idx     on public.opportunities (stage) where stage not in ('gagne','perdu');

comment on table public.opportunities is 'Affaires / deals : montant, étape, probabilité, closing. Base du pipeline de vente et des prévisions pondérées.';
