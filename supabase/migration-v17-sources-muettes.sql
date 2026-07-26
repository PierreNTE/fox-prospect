-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION v17 — Distinguer « a tourné » de « a rapporté quelque chose »
--
-- Idempotente : réexécutable sans effet de bord.
-- Dépend de v12 (veille_sources).
--
-- POURQUOI.
-- `last_ok_at` était mis à jour dès qu'une collecte se terminait sans lever
-- d'exception — y compris quand elle ne rapportait AUCUN document. Une source
-- tarie affichait donc exactement la même santé qu'une source féconde, et
-- l'écran de veille annonçait « toutes les sources actives ont collecté ces
-- trois derniers jours » alors que trois salles de presse sur cinq n'avaient
-- rien rapporté depuis des semaines.
--
-- Le coût de cet angle mort a été mesuré le 26 juillet : deux causes distinctes
-- (fenêtre de collecte inadaptée à la cadence d'une salle de presse, et tri par
-- langue vidant un flux entier) coexistaient depuis l'origine sans qu'aucun
-- écran ne les signale. Elles n'ont été trouvées qu'en interrogeant la base à
-- la main.
--
-- Le module de veille existe pour rendre visible ce qui se tarit en silence.
-- Sa propre supervision ne peut pas faire l'inverse.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.veille_sources
  add column if not exists last_document_at timestamptz;

comment on column public.veille_sources.last_document_at is
  'Dernière collecte ayant rapporté au moins un document. Distinct de last_ok_at, qui ne dit que « la collecte n''a pas planté ».';

comment on column public.veille_sources.last_ok_at is
  'Dernière collecte terminée sans erreur — même à zéro document. Pour la santé réelle, lire last_document_at.';


-- Amorçage depuis l'historique déjà journalisé : sans cela, toutes les sources
-- paraîtraient muettes au premier passage suivant la migration, ce qui
-- remplacerait un angle mort par une fausse alerte.
update public.veille_sources s
set last_document_at = h.dernier
from (
  select source_id, max(started_at) as dernier
  from public.pipeline_runs
  where stage = 'collecte' and collected > 0 and source_id is not null
  group by source_id
) as h
where h.source_id = s.id
  and s.last_document_at is null;


-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification post-migration (à exécuter séparément) :
--
--   select label,
--          last_ok_at::date        as a_tourne,
--          last_document_at::date  as a_rapporte
--   from public.veille_sources
--   where enabled order by last_document_at nulls first;
-- ═══════════════════════════════════════════════════════════════════════════
