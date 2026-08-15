-- v22 — curseur de pagination de l'import SIRENE, côté serveur (2026-08-15).
--
-- Le curseur vivait dans l'état React de la page Comptes. Il repartait donc à 1
-- à chaque rechargement, et le deuxième import rescannait les mêmes sociétés :
-- observé le 2026-08-15, un clic de reprise a ramené 1 compte au lieu des 16
-- disponibles, les 8 premières pages étant déjà toutes en base.
--
-- Un curseur de progression sur une ressource partagée est un état de compte,
-- pas un état d'écran : il appartient au serveur. Ainsi il survit au
-- rechargement, au changement de navigateur et à la reprise à plusieurs jours.
alter table settings add column if not exists sirene_page integer not null default 1;

comment on column settings.sirene_page is
  'Prochaine page à scanner pour /api/accounts/import-sirene. Avance seule à chaque import ; remettre à 1 pour repartir du début de la base.';

-- Les 8 premières pages ont déjà été scannées (imports des 14 et 15 août).
update settings set sirene_page = 9 where id = 1 and sirene_page < 9;
