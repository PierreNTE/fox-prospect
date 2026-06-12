-- Fox Prospect — schéma Supabase
-- À exécuter dans le SQL Editor de ton projet Supabase (une seule fois).

create table if not exists settings (
  id int primary key default 1,
  offer text default '',
  sender_name text default '',
  sender_role text default '',
  sender_company text default '',
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);

insert into settings (id) values (1) on conflict (id) do nothing;

create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  first_name text not null default '',
  last_name text not null default '',
  role text default '',
  company text not null,
  company_website text default '',
  linkedin_url text default '',
  email text default '',
  status text not null default 'nouveau',
  fit_score int,
  notes text default '',
  created_at timestamptz default now()
);

create index if not exists prospects_status_idx on prospects (status);

create table if not exists research (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  summary text,
  signals jsonb default '[]',
  hooks jsonb default '[]',
  fit_score int,
  fit_reason text,
  sources jsonb default '[]',
  created_at timestamptz default now()
);

create index if not exists research_prospect_idx on research (prospect_id, created_at desc);

create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  email_subject text,
  email_body text,
  linkedin_message text,
  call_points jsonb default '[]',
  created_at timestamptz default now()
);

create index if not exists drafts_prospect_idx on drafts (prospect_id, created_at desc);

-- Liste d'opposition permanente (obligation RGPD) :
-- tout contact qui demande à ne plus être sollicité y entre, et n'en sort jamais.
create table if not exists optout (
  email text primary key,
  reason text default '',
  created_at timestamptz default now()
);

-- ============================================================
-- SÉCURITÉ : Row Level Security activé sur toutes les tables.
-- Aucune policy n'est définie => l'API publique Supabase (clé anon)
-- ne peut RIEN lire ni écrire. Seule l'app (clé service_role,
-- côté serveur uniquement) accède aux données.
-- ============================================================
alter table settings enable row level security;
alter table prospects enable row level security;
alter table research enable row level security;
alter table drafts enable row level security;
alter table optout enable row level security;
