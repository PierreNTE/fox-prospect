-- v37 — Suivi des emails envoyés : une ligne par email envoyé à un lead
-- (collé depuis l'agent Sales Chat « suivi des envois » ou depuis Outlook).
-- Sert à éviter les doublons et à repérer les erreurs (STOP, lead clos…).
-- Jamais le corps du message ; jamais les adresses internes Dell.
create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  to_email text not null default '',
  to_name text not null default '',
  subject text not null default '',
  sent_at timestamptz not null,
  status text not null default 'envoye',   -- envoye | reponse | non_remis | stop
  source text not null default '',
  dedup_key text not null unique,          -- adresse | objet | jour : un envoi n'est compté qu'une fois
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_log_account_idx on public.email_log (account_id, sent_at desc);
create index if not exists email_log_sent_idx on public.email_log (sent_at desc);
alter table public.email_log enable row level security;
