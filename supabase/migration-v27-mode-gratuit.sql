-- v27 — mode 100 % gratuit (2026-11-23).
-- Nouveau job du worker : find_website (recherche du site officiel par le
-- moteur local SearXNG, retenu seulement si le SIREN y figure). Idempotente.
alter table public.scrape_jobs drop constraint if exists scrape_jobs_kind_check;
alter table public.scrape_jobs add constraint scrape_jobs_kind_check
  check (kind in ('discover', 'enrich', 'discover_and_enrich', 'find_website'));
