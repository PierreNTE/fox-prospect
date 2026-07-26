-- Fox Prospect — migration v11 : copilote IA (Jalon 3). Idempotente.
-- À exécuter dans le SQL Editor de Supabase.

-- IA1 — briefing de préparation de RDV, mis en cache sur le compte : généré à la
-- demande, on ne redépense pas tant que l'utilisateur ne force pas la régénération.
alter table public.accounts add column if not exists rdv_brief jsonb;
alter table public.accounts add column if not exists rdv_brief_at timestamptz;

-- IA4 — suivi des décideurs : résultat du dernier contrôle de poste d'un contact.
alter table public.account_contacts add column if not exists job_check_status text default '';
alter table public.account_contacts add column if not exists job_check_note text default '';
alter table public.account_contacts add column if not exists job_checked_at timestamptz;

comment on column public.accounts.rdv_brief is 'Briefing de preparation de RDV genere par IA (Jalon 3), mis en cache pour ne pas redepenser.';
comment on column public.account_contacts.job_check_status is 'Dernier controle de poste : en_poste | change_de_poste | parti | incertain.';
