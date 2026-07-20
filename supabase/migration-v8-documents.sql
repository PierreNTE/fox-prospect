-- Fox Prospect — migration v8 : documents rattachés (devis, comptes-rendus,
-- contrats, présentations…).
-- À exécuter dans le SQL Editor de Supabase (idempotent : "if not exists"
-- partout, aucune donnée existante modifiée).
--
-- Modèle : rattachement polymorphe « exactement un » — un document appartient
-- à UN compte OU UN prospect OU UN contact d'organigramme, jamais plusieurs,
-- jamais aucun (contrainte CHECK). Pas de double classement : la fiche compte
-- AGRÈGE à l'affichage (docs du compte + de ses contacts + de ses prospects).

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete cascade,
  account_contact_id uuid references account_contacts(id) on delete cascade,
  path text not null,                -- clé du fichier dans le bucket "documents"
  name text not null,                -- nom affiché (nom de fichier d'origine)
  mime text default '',
  size_bytes bigint default 0,
  category text not null default 'autre'
    check (category in ('devis', 'compte_rendu', 'contrat', 'presentation', 'autre')),
  tags text[] default '{}',
  note text default '',
  created_at timestamptz default now(),
  check (num_nonnulls(account_id, prospect_id, account_contact_id) = 1)
);

create index if not exists documents_account_idx
  on documents (account_id, created_at desc) where account_id is not null;
create index if not exists documents_prospect_idx
  on documents (prospect_id, created_at desc) where prospect_id is not null;
create index if not exists documents_contact_idx
  on documents (account_contact_id, created_at desc) where account_contact_id is not null;

alter table documents enable row level security;
-- Pas de policy : seul le service_role (les routes API) lit/écrit, comme les
-- autres tables. Les fichiers eux-mêmes passent par des URLs signées.

-- Bucket PRIVÉ pour les fichiers. L'insert fonctionne depuis le SQL Editor ;
-- si votre projet le refuse, créer le bucket "documents" (privé) via
-- Dashboard → Storage → New bucket.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
