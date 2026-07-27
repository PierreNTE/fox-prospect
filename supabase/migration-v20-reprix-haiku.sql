-- v20 — Reprise tarifaire des lignes Haiku d'ai_runs (appliquée le 2026-07-27).
--
-- CONTEXTE
-- `ANTHROPIC_TARIF` (lib/constants.js) et ses trois copies portaient 0,25 / 1,25 €
-- par million de jetons : le tarif de Claude 3.5 Haiku. Le modèle réellement
-- appelé est `claude-haiku-4-5-20251001`, facturé 1,00 $ / 5,00 $, soit
-- 0,93 / 4,65 € — un facteur 3,7. Tous les `cost_eur` calculés en Haiku depuis
-- le 2026-06-18 sont donc sous-évalués d'autant, et le kill-switch mensuel de
-- lib/budget.js, qui somme cette colonne, comptait faux dans le même sens.
--
-- COMMENT LES LIGNES SONT IDENTIFIÉES
-- `ai_runs` ne stocke pas le modèle appelé (c'est ce qui a rendu le bug
-- indétectable). Mais `cost_eur` a été calculé de façon déterministe :
--     cost = in/1e6 × Tin + out/1e6 × Tout + searches/1e3 × 9,3
-- et dans les deux tables de tarifs Tout = 5 × Tin. Le tarif d'entrée appliqué
-- est donc exactement récupérable :
--     Tin = (cost − searches/1e3 × 9,3) / (in + 5 × out) × 1e6
-- La distribution mesurée était strictement bimodale — 404 lignes à 0,25 et
-- 356 à 2,80, aucune valeur intermédiaire — ce qui rend le classement sûr.
-- Trois lignes Haiku ne portaient aucune recherche web : les classer par route
-- les aurait manquées, le tarif implicite les attrape.
--
-- EFFET MESURÉ
-- 404 lignes reprises, total passé de 13,58 € à 23,71 € sur tout l'historique,
-- dont +4,35 € sur le seul mois de juillet 2026 — soit très exactement le trou
-- constaté au rapprochement avec la console Anthropic, et longtemps imputé à
-- des scripts non journalisés.
--
-- À APPLIQUER UNE SEULE FOIS. Le filtre est auto-limitant (une ligne déjà
-- reprise porte 0,93 et ne retombe plus dans la fenêtre 0,24–0,26), mais la
-- table de trace ci-dessous est la garantie de réversibilité.

create table if not exists ai_runs_reprix_20260727 (
  ai_run_id      bigint primary key references ai_runs(id) on delete cascade,
  cost_eur_avant numeric not null,
  cost_eur_apres numeric not null,
  reprix_at      timestamptz not null default now()
);

comment on table ai_runs_reprix_20260727 is
  'Sauvegarde des cost_eur avant correction du tarif Haiku (3.5 -> 4.5) le 2026-07-27.';

with cible as (
  select id,
         cost_eur as avant,
         round((input_tokens/1e6*0.93 + output_tokens/1e6*4.65
                + web_search_count/1000.0*9.3)::numeric, 5) as apres
  from ai_runs
  where (cost_eur - web_search_count/1000.0*9.3)
        / nullif(input_tokens + output_tokens*5, 0) * 1e6
        between 0.24 and 0.26
),
trace as (
  insert into ai_runs_reprix_20260727 (ai_run_id, cost_eur_avant, cost_eur_apres)
  select id, avant, apres from cible
  on conflict (ai_run_id) do nothing
  returning ai_run_id
)
update ai_runs a set cost_eur = c.apres
from cible c where a.id = c.id;

-- Retour arrière, si le rapprochement avec la console devait l'imposer :
--   update ai_runs a set cost_eur = r.cost_eur_avant
--   from ai_runs_reprix_20260727 r where a.id = r.ai_run_id;
--
-- Une fois le rapprochement validé, la table de trace peut être supprimée :
--   drop table ai_runs_reprix_20260727;
