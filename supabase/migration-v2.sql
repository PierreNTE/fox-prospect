-- ============================================================
-- Migration V2 — À exécuter dans Supabase SQL Editor
-- ============================================================

-- ICP paramétrable stocké dans les settings (JSON).
alter table public.settings
  add column if not exists icp jsonb not null default '{}'::jsonb;

-- Nouveaux statuts prospects (répondu, rdv, perdu déjà présents dans l'UI
-- mais pas contraints en base — on les normalise sans casser l'existant).
-- Pas de contrainte CHECK pour rester souple sur les valeurs custom.

-- Email confidence sur les prospects (déjà utilisé dans lib/schemas.js).
alter table public.prospects
  add column if not exists email_confidence text default '',
  add column if not exists email_source     text default '';
