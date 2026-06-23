-- ============================================================
-- Migration V4 (P2) — Simplification des statuts commerciaux
-- À exécuter dans Supabase SQL Editor. Idempotente.
--
-- Le statut prospect n'encode désormais QUE la situation commerciale
-- (non_contacte / contacte / en_cours / interesse / refuse / client).
-- Deux concepts auparavant mêlés au statut sont extraits :
--   • l'état de recherche IA → prospects.researched_at (NULL = à qualifier) ;
--   • l'opposition RGPD       → prospects.do_not_contact (drapeau séparé).
--
-- Réversible : non_contacte + researched_at NULL  ⟺ ancien 'nouveau' ;
--              non_contacte + researched_at défini ⟺ ancien 'recherché'.
-- ============================================================

-- 1) Nouvelles colonnes.
alter table public.prospects
  add column if not exists do_not_contact boolean not null default false,
  add column if not exists researched_at  timestamptz;

-- 2) Découplage de l'état de recherche : researched_at = date de la 1re qualif IA.
--    Correspondance 1:1 vérifiée avec l'ancien statut 'recherché'.
update public.prospects p
   set researched_at = coalesce(
         (select min(r.created_at) from public.research r where r.prospect_id = p.id),
         p.created_at)
 where researched_at is null
   and (status = 'recherché'
        or exists (select 1 from public.research r where r.prospect_id = p.id));

-- 3) Opposition RGPD séparée : l'ancien statut 'opt-out' devient un drapeau.
update public.prospects set do_not_contact = true where status = 'opt-out';

-- 4) Migration des valeurs de statut vers le funnel commercial simplifié.
update public.prospects set status = case status
  when 'nouveau'   then 'non_contacte'
  when 'recherché' then 'non_contacte'
  when 'contacté'  then 'contacte'
  when 'répondu'   then 'en_cours'
  when 'rdv'       then 'interesse'
  when 'perdu'     then 'refuse'
  when 'opt-out'   then 'non_contacte'
  else status
end;

-- 5) Nouveau défaut.
alter table public.prospects alter column status set default 'non_contacte';

-- 6) Index partiel pour la file de qualif (researched_at IS NULL = à rechercher).
create index if not exists prospects_unresearched_idx
  on public.prospects (created_at) where researched_at is null;
