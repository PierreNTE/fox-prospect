-- Fox Prospect — migration Sprint 3 : base de grands comptes + cartographie.
-- À exécuter dans le SQL Editor de Supabase (une seule fois, sans risque :
-- "if not exists" partout, aucune donnée existante modifiée).

-- ── Comptes (entreprises) ────────────────────────────────────────────
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text default '',
  domain text default '',
  sector text default '',
  hq text default '',
  summary text default '',
  news jsonb default '[]',          -- [{title, detail, date, source, scope, category}]
  signals jsonb default '[]',       -- [{type, detail, date, source, confidence}]
  sources jsonb default '[]',
  last_refreshed_at timestamptz,
  auto_watch boolean default true,  -- inclus dans la veille automatique
  created_at timestamptz default now()
);

create unique index if not exists accounts_name_key on accounts (lower(name));

-- ── Contacts cartographiés (organigramme) ────────────────────────────
-- Une personne rattachée à un compte. manager_id pointe vers son responsable
-- (même table) pour reconstituer l'arbre. Lien optionnel vers un prospect actif.
create table if not exists account_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete set null,
  manager_id uuid references account_contacts(id) on delete set null,
  first_name text default '',
  last_name text default '',
  role text default '',
  responsibilities text default '',
  email text default '',
  phone text default '',
  linkedin_url text default '',
  -- Fiabilité des coordonnées : 'verifie' | 'partiel' | 'non_verifie'
  reliability text default 'non_verifie',
  -- Confiance sur le poste/responsabilités : 'certain' | 'probable' | 'incertain'
  role_confidence text default 'incertain',
  data_date text default '',        -- fraîcheur : quand l'info a été observée (YYYY-MM)
  source text default '',
  validated boolean default false,  -- Pierre a confirmé cette fiche
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists account_contacts_account_idx on account_contacts (account_id);
create index if not exists account_contacts_manager_idx on account_contacts (manager_id);

-- Rattachement optionnel d'un prospect existant à un compte.
alter table prospects add column if not exists account_id uuid references accounts(id) on delete set null;

-- ── Sécurité : RLS (clé service_role côté serveur uniquement) ─────────
alter table accounts enable row level security;
alter table account_contacts enable row level security;
