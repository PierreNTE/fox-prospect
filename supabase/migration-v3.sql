-- ============================================================
-- Migration V3 — À exécuter dans Supabase SQL Editor
-- Idempotente : peut être rejouée sans erreur.
-- ============================================================

-- ── Table events ───────────────────────────────────────────────────────────
-- Crée la table sans account_id d'abord (évite le problème si la table
-- existe déjà ou si accounts n'est pas encore résolu).
create table if not exists public.events (
  id           bigint generated always as identity primary key,
  prospect_id  uuid references public.prospects(id) on delete cascade,
  kind         text not null check (kind in (
    'status_change', 'email_sent', 'call_made', 'rdv_booked',
    'reply_received', 'note_added', 'research_done',
    'draft_generated', 'auto_action', 'signal_detected', 'enrich_done'
  )),
  from_status  text,
  to_status    text,
  note         text,
  occurred_at  timestamptz not null default now()
);

-- Ajoute account_id séparément : IF NOT EXISTS garantit l'idempotence
-- même si la table existait déjà sans cette colonne.
alter table public.events
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

-- Index : IF NOT EXISTS = idempotent
create index if not exists events_prospect_idx  on public.events (prospect_id, occurred_at desc);
create index if not exists events_kind_date_idx on public.events (kind, occurred_at desc);
create index if not exists events_account_idx   on public.events (account_id, occurred_at desc);

alter table public.events enable row level security;

-- ── Table push_subscriptions ───────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  endpoint   text unique not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text default '',
  created_at timestamptz default now()
);

alter table public.push_subscriptions enable row level security;
