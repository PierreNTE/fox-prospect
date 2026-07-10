-- ============================================================
-- Migration V8 (Sprint 3 — Cockpit SDR) — À exécuter dans Supabase SQL Editor.
-- Idempotente.
--
-- Apporte :
--   1. Tags sur les prospects (segmentation : « banque-NIS2 », « salon-2026 »…)
--   2. Vues sauvegardées (filtres nommés réutilisables)
-- ============================================================

-- 1. Tags (tableau texte + index GIN pour le filtre "tag présent").
alter table public.prospects
  add column if not exists tags text[] not null default '{}';

create index if not exists prospects_tags_idx
  on public.prospects using gin (tags);

-- 2. Vues sauvegardées : sérialisation des filtres du tableau de bord.
--    filters = { q, status, minScore, tag, sortBy } — schéma libre côté app.
create table if not exists public.saved_views (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  filters    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.saved_views enable row level security;

comment on table public.saved_views is
  'Vues sauvegardées du tableau de bord (filtres nommés). Multi-tenant : org_id à ajouter au Sprint 4.';
