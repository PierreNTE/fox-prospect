-- Fox Prospect — migration v7 : refonte de la fiche compte (organigramme enrichi).
-- À exécuter dans le SQL Editor de Supabase (idempotent : "if not exists" partout).

-- Service / département de rattachement (DSI, Finance, Data…) et niveau
-- hiérarchique ('direction' | 'management' | 'operationnel') pour lire
-- l'organigramme d'un coup d'œil : qui décide, qui influence.
alter table account_contacts add column if not exists department text default '';
alter table account_contacts add column if not exists level text default '';

-- Traçabilité de l'email enrichi (confiance + provenance), pour afficher un
-- niveau de fiabilité de la coordonnée directement dans l'organigramme.
alter table account_contacts add column if not exists email_confidence text default '';
alter table account_contacts add column if not exists email_source text default '';
