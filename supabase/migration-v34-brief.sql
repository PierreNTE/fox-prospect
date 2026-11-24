-- v34 — Brief d'appel et contrôles d'anomalies.
--   sf_paste_flags : données société lues dans la fiche Salesforce collée
--     (code postal, commune, rue) + codes d'anomalie. Jamais de nom de
--     collaborateur Dell, jamais d'email ou de téléphone nominatif.
--   bad_phones : numéros marqués « non attribué » au téléphone (écartés).
--   call_status « faux_numero » : numéro non attribué.
--   Le brief lui-même est calculé à la lecture (lib/call-brief.js) : toujours à jour.
alter table accounts add column if not exists sf_paste_flags jsonb;
alter table accounts add column if not exists bad_phones text[] not null default '{}';
alter table accounts drop constraint if exists accounts_call_status_check;
alter table accounts add constraint accounts_call_status_check check (call_status is null or call_status = any (array[
  'a_appeler','pas_joignable','rappeler','rdv','pas_interesse','mauvais_contact','faux_numero']));
