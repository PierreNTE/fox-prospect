-- v21 — `ai_runs.model` : rendre la comptabilité IA vérifiable (2026-08-13).
--
-- POURQUOI
-- `cost_eur` est un tarif appliqué à des jetons, mais la table ne disait pas
-- QUEL tarif. Conséquence vécue : `ANTHROPIC_TARIF` a porté le prix de Claude
-- 3.5 Haiku pour un modèle haiku-4-5 (facteur 3,7) pendant des semaines sans que
-- rien dans la base ne puisse le révéler — il a fallu reconstruire le modèle par
-- inférence sur le tarif implicite pour s'en apercevoir. Une colonne rend
-- l'erreur suivante détectable en une requête, au lieu d'un rapprochement
-- manuel avec la console.
--
-- RÉTRO-REMPLISSAGE
-- Même méthode que la v20 : `cost_eur` ayant été calculé de façon déterministe
-- et le prix de sortie valant 5× celui d'entrée dans toutes les tables de
-- tarifs, le tarif d'entrée appliqué est exactement récupérable :
--     Tin = (cost − searches/1e3 × 9,3) / (in + 5 × out) × 1e6
-- La distribution est bimodale à 0,93 (Haiku 4.5) et 2,80 (Sonnet 4.6).
--
-- SECONDE REPRISE TARIFAIRE
-- Le rétro-remplissage a mis au jour 226 lignes du 1er au 9 août encore
-- calculées à 0,25 : le correctif de tarif (commit acedaaa) n'a été DÉPLOYÉ que
-- le 9 août, alors que la v20 avait repris l'historique dès le 27 juillet. Ces
-- lignes sont reprises ici selon la même règle, +2,43 € sur le mois d'août.
-- C'est la démonstration du problème que cette colonne résout : sans elle,
-- l'écart serait resté invisible une seconde fois.

alter table ai_runs add column if not exists model text;

comment on column ai_runs.model is
  'Modèle Anthropic appelé. Rétro-rempli par inférence du tarif implicite pour les lignes antérieures au 2026-08-13 (voir migration v21).';

-- 1. Classement de l'historique déjà au bon tarif.
update ai_runs set model = case
    when (cost_eur - web_search_count/1000.0*9.3)
         / nullif(input_tokens + output_tokens*5, 0) * 1e6 between 0.85 and 1.00
      then 'claude-haiku-4-5-20251001'
    when (cost_eur - web_search_count/1000.0*9.3)
         / nullif(input_tokens + output_tokens*5, 0) * 1e6 between 2.70 and 2.90
      then 'claude-sonnet-4-6'
    else null
  end
where model is null;

-- 2. Reprise des lignes restées au tarif Haiku 3.5 (déploiement tardif).
--    La table de trace de la v20 est réutilisée : une seule histoire tarifaire.
with cible as (
  select id, cost_eur as avant,
         round((input_tokens/1e6*0.93 + output_tokens/1e6*4.65
                + web_search_count/1000.0*9.3)::numeric, 5) as apres
  from ai_runs
  where model is null
    and (cost_eur - web_search_count/1000.0*9.3)
        / nullif(input_tokens + output_tokens*5, 0) * 1e6 between 0.24 and 0.26
),
trace as (
  insert into ai_runs_reprix_20260727 (ai_run_id, cost_eur_avant, cost_eur_apres)
  select id, avant, apres from cible on conflict (ai_run_id) do nothing
  returning ai_run_id
)
update ai_runs a
set cost_eur = c.apres,
    model = 'claude-haiku-4-5-20251001'
from cible c where a.id = c.id;

-- Le kill-switch filtre sur (created_at), l'audit tarifaire sur (model, created_at).
create index if not exists ai_runs_model_created_idx on ai_runs (model, created_at desc);

-- Contrôle attendu : deux classes, aucune ligne non classée, tarifs conformes.
--   select model, count(*),
--          round((((sum(cost_eur) - sum(web_search_count)/1000.0*9.3))
--                 / nullif(sum(input_tokens)+sum(output_tokens)*5,0) * 1e6)::numeric,3)
--   from ai_runs group by 1;
