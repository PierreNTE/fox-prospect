-- v36 — Import du report Salesforce (.xls / .csv).
--   sf_lead_id : « Lead Tracking ID » du lead, pour retrouver le même lead d'un
--     import à l'autre même si le nom de la société change.
--   sf_duns : « Legal GU DUNS » (DUNS du groupe), repère les sociétés d'un même groupe.
alter table accounts add column if not exists sf_lead_id text;
alter table accounts add column if not exists sf_duns text;
create index if not exists accounts_sf_lead_id_idx on accounts (sf_lead_id) where sf_lead_id is not null;
