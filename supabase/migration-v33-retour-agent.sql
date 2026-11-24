-- v33 — Retour de l'agent Sales Chat.
--   email_opt_out : la société a demandé à ne plus recevoir d'email (STOP) →
--                   plus jamais dans le fichier de la semaine.
--   bounced_emails : adresses revenues en erreur → plus jamais proposées.
alter table accounts add column if not exists email_opt_out boolean not null default false;
alter table accounts add column if not exists bounced_emails text[] not null default '{}';
