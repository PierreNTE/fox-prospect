-- v30 — Nouveau type de recherche du worker : find_phone (standard des leads).
alter table scrape_jobs drop constraint if exists scrape_jobs_kind_check;
alter table scrape_jobs add constraint scrape_jobs_kind_check
  check (kind = any (array['discover','enrich','discover_and_enrich','find_website','find_phone']));
