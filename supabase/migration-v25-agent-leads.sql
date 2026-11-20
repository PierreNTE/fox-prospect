-- v25 — agent hebdomadaire des leads (2026-11-20).
--
-- Nouveau type de job `call_prep` (fiche d'approche IA + web, mise en file par
-- lib/leads-agent.js). On ajoute aussi `enrich_contact`, utilisé par
-- /api/accounts/[id]/enrich-missing mais absent de la contrainte : ces
-- insertions échouaient. Idempotente.

alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in (
  'analyze_account', 'research_prospect', 'enrich_prospect', 'enrich_contact', 'call_prep'
));

create index if not exists jobs_kind_created_idx on public.jobs (kind, created_at desc);
