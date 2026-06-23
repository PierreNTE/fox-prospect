-- ============================================================
-- Migration V5 (P3) — Historique des interactions commerciales
-- À exécuter dans Supabase SQL Editor. Idempotente.
--
-- Enrichit la timeline `events` (canal / prochaine action / relance) et
-- expose le plan de relance courant sur le prospect (dénormalisé).
-- ============================================================

-- 1) events : champs pour les logs manuels riches.
alter table public.events
  add column if not exists channel      text,   -- appel / email / linkedin / autre
  add column if not exists next_action  text,
  add column if not exists follow_up_at date;

-- 2) events : élargir la contrainte kind. Corrige les rejets silencieux
--    (research_done, draft_generated n'étaient jamais enregistrés) + 'interaction'.
alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in (
  'interaction','status_change','research_done','draft_generated','enrich_done',
  'auto_action','signal_detected','opt_out','note_added',
  'email_sent','email_opened','reply','call','rdv'   -- legacy conservés
));

-- 3) events : partition DEFAULT — filet de sécurité pour tout occurred_at hors
--    2026/2027 (ex. interaction antidatée), évite un échec de routage de partition.
create table if not exists public.events_default partition of public.events default;

-- 4) prospects : plan de relance courant (dénormalisé pour liste / NBA / relances).
alter table public.prospects
  add column if not exists next_action  text default '',
  add column if not exists follow_up_at date;

create index if not exists prospects_followup_idx
  on public.prospects (follow_up_at) where follow_up_at is not null;
