-- v26 — collecte web gratuite par compte (2026-11-20).
-- web_intel : site officiel, standard, emails, réseaux, outils (site + DNS),
-- emails probables des dirigeants, marchés publics IT. Voir lib/account-intel.js.
alter table public.accounts add column if not exists web_intel jsonb;
alter table public.accounts add column if not exists web_intel_at timestamptz;
create index if not exists accounts_web_intel_at_idx on public.accounts (web_intel_at) where source = 'salesforce';
