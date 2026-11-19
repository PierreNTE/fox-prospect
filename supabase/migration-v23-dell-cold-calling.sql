-- v23 — module cold calling Dell (2026-11-19).
--
-- 1. Import des leads Salesforce (export PDF « Printable View ») en comptes, avec
--    un contrôle de santé : SIREN, état administratif, procédures collectives BODACC.
-- 2. Fiche de qualification infra Dell (serveurs / stockage / backup) + BANT,
--    d'où l'app génère le résumé à coller dans Salesforce.
-- 3. Préparation d'appel (actu, interlocuteur cible, passage du standard).
--
-- Minimisation : on ne stocke du PDF que le nom de société, le statut du lead et
-- la campagne. Les noms des collaborateurs Dell (Account Owner, Buyer Lever) ne
-- sont jamais enregistrés.

alter table public.accounts add column if not exists source text default '';
alter table public.accounts add column if not exists sf_lead_status text default '';
alter table public.accounts add column if not exists sf_campaign text default '';

-- Santé société : 'active' | 'vigilance' | 'fermee' | 'introuvable'
alter table public.accounts add column if not exists health_status text default '';
alter table public.accounts add column if not exists health_label text default '';
alter table public.accounts add column if not exists health_detail jsonb;
alter table public.accounts add column if not exists health_checked_at timestamptz;

-- Qualification Dell : { servers: {...}, storage: {...}, backup: {...}, bant: {...} }
alter table public.accounts add column if not exists dell_qualif jsonb default '{}'::jsonb;
alter table public.accounts add column if not exists dell_qualif_at timestamptz;

-- Préparation d'appel générée par l'IA (mise en cache, régénérée sur demande).
alter table public.accounts add column if not exists call_prep jsonb;
alter table public.accounts add column if not exists call_prep_at timestamptz;

create index if not exists accounts_health_status_idx on public.accounts (health_status);
create index if not exists accounts_source_idx on public.accounts (source);

comment on column public.accounts.health_status is
  'Contrôle SIRENE + BODACC : active | vigilance (procédure en cours) | fermee | introuvable.';
comment on column public.accounts.dell_qualif is
  'Qualification infra Dell (serveurs, stockage, backup) + BANT. Source du résumé Salesforce.';
