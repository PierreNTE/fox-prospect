-- v35 — Historique des appels : une ligne par résultat d'appel noté
-- (session d'appels ou bouton de statut sur la fiche). Sert au compteur de
-- tentatives et au bilan de la semaine. Pas de note ni de nom : seulement
-- le résultat et l'heure.
create table if not exists public.call_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  outcome text not null,
  created_at timestamptz not null default now()
);
create index if not exists call_log_account_idx on public.call_log (account_id, created_at desc);
create index if not exists call_log_created_idx on public.call_log (created_at desc);
alter table public.call_log enable row level security;
