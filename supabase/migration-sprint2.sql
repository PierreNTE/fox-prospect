-- Fox Prospect — migration Sprint 2 : enrichissement des coordonnées.
-- À exécuter dans le SQL Editor de Supabase (une seule fois, sans risque :
-- "if not exists" partout, aucune donnée existante modifiée).

alter table prospects add column if not exists phone text default '';
alter table prospects add column if not exists email_confidence text default '';
alter table prospects add column if not exists email_source text default '';
