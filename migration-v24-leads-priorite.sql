-- v24 — suivi hebdomadaire des leads Salesforce (2026-11-20).
--
-- sf_first_seen_at : premier import où le lead apparaît (badge « Nouveau », 7 jours).
-- sf_last_seen_at  : dernier import où il apparaît. Un lead absent du dernier
--                    import a été réattribué ou clos dans Salesforce.
--
-- La priorité d'appel (lib/lead-priority.js) est calculée à la volée à partir de
-- health_detail : aucune colonne de score à maintenir. Idempotente.

alter table public.accounts add column if not exists sf_first_seen_at timestamptz;
alter table public.accounts add column if not exists sf_last_seen_at timestamptz;

-- Comptes Salesforce déjà importés : on initialise avec la date de création.
update public.accounts
   set sf_first_seen_at = coalesce(sf_first_seen_at, created_at),
       sf_last_seen_at  = coalesce(sf_last_seen_at, health_checked_at, created_at)
 where source = 'salesforce';

create index if not exists accounts_sf_last_seen_idx on public.accounts (sf_last_seen_at) where source = 'salesforce';
