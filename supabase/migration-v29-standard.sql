-- v29 — Standard téléphonique du lead : saisi à la main ou trouvé par le
-- worker (recherche web gratuite). Le numéro du site officiel reste dans
-- web_intel.phones ; celui-ci le complète quand le site n'en donne pas.
alter table accounts add column if not exists standard_phone text;
alter table accounts add column if not exists standard_source text;
