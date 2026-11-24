-- v31 — Un email par lead + export hebdomadaire pour l'agent Sales Chat.
--   found_email / found_email_source : email trouvé par le worker (extraits de
--   recherche) ou saisi à la main ('manuel', prioritaire).
--   email_exported_at : dernier export vers l'agent (évite les doublons d'envoi).
alter table accounts add column if not exists found_email text;
alter table accounts add column if not exists found_email_source text;
alter table accounts add column if not exists email_exported_at timestamptz;
alter table scrape_jobs drop constraint if exists scrape_jobs_kind_check;
alter table scrape_jobs add constraint scrape_jobs_kind_check
  check (kind = any (array['discover','enrich','discover_and_enrich','find_website','find_phone','find_email']));
