-- ============================================================
-- Migration V6 (P4) — Brief commercial à la demande
-- À exécuter dans Supabase SQL Editor. Idempotente.
--
-- Stocke l'analyse approfondie OPTIONNELLE déclenchée par l'utilisateur
-- (DISC + changements récents + accroches + entourage). Séparée de `research`
-- pour ne jamais alourdir la qualification automatique : le coût IA du brief
-- n'est dépensé que sur action manuelle, sous le plafond budgétaire mensuel.
-- ============================================================

create table if not exists public.prospect_briefs (
  id                  uuid primary key default gen_random_uuid(),
  prospect_id         uuid not null references public.prospects(id) on delete cascade,
  disc                jsonb,                       -- { profil, traits[], style_communication, a_faire[], a_eviter[], confiance, base }
  changements_recents jsonb not null default '[]', -- [{ type, detail, date, source, accroche }]
  accroches           jsonb not null default '[]', -- [{ angle, phrase, canal }]
  entourage           jsonb not null default '{}', -- { equipe[], decideurs[], contacts_secondaires[] }
  synthese_approche   text,
  sources             jsonb not null default '[]',
  created_at          timestamptz not null default now()
);

create index if not exists prospect_briefs_idx on public.prospect_briefs (prospect_id, created_at desc);

-- Sécurité : RLS activé, aucune policy => accès uniquement via service_role.
alter table public.prospect_briefs enable row level security;
