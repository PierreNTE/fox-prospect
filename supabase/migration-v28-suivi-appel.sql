-- v28 — suivi d'appel sur les leads (2026-11-23).
-- Un statut simple par compte, une note et une date de rappel : c'est ce qui
-- remplace l'agenda, les séquences et le pipeline pour la prospection.
alter table public.accounts add column if not exists call_status text;
alter table public.accounts add column if not exists call_note text;
alter table public.accounts add column if not exists recall_at date;
alter table public.accounts add column if not exists call_updated_at timestamptz;
alter table public.accounts drop constraint if exists accounts_call_status_check;
alter table public.accounts add constraint accounts_call_status_check check (
  call_status is null or call_status in ('a_appeler', 'pas_joignable', 'rappeler', 'rdv', 'pas_interesse', 'mauvais_contact')
);
create index if not exists accounts_recall_at_idx on public.accounts (recall_at) where source = 'salesforce';
