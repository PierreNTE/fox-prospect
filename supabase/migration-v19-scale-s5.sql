-- ============================================================
-- Migration V19 (Sprint 5 — Échelle) — À exécuter dans Supabase SQL Editor.
-- Idempotente.
--
-- RENUMÉROTÉE de v10 en v19 lors du rebasage du 26 juillet : le numéro v10 avait
-- été attribué entre-temps à `migration-v10-opportunities.sql`.
--
-- La colonne `tags` créée ici n'est lue par AUCUN code de cette branche : elle
-- venait avec le cockpit SDR (S3), écarté. Elle est conservée — inoffensive et
-- prête si la segmentation revient — mais volontairement HORS des colonnes
-- listées par lib/data.js, pour que le code ne dépende pas de cette migration.
--
-- Vue hot_accounts : LA requête qui génère des RDV (audit §8.4) —
-- « quels comptes ont un signal frais (< 14 j) et AUCUN prospect contacté
-- récemment (< 30 j) ? ». Rendue possible par l'unification des signaux
-- dans company_signals (S1). Zéro LLM, recalculée à la lecture.
-- ============================================================

create or replace view public.hot_accounts as
select
  a.id          as account_id,
  a.name,
  a.sector,
  a.company_id,
  count(s.id)   as fresh_signals,
  max(s.observed_at) as last_signal_at,
  (array_agg(s.detail order by s.observed_at desc))[1] as top_signal_detail,
  (array_agg(s.type   order by s.observed_at desc))[1] as top_signal_type
from public.accounts a
join public.company_signals s
  on (s.account_id = a.id or (a.company_id is not null and s.company_id = a.company_id))
 and s.observed_at >= current_date - interval '14 days'
 and s.status <> 'écarté'
where not exists (
  -- aucun prospect du compte contacté dans les 30 derniers jours
  select 1
  from public.prospects p
  join public.events e on e.prospect_id = p.id
  where p.account_id = a.id
    and e.kind in ('interaction', 'email_sent', 'call', 'rdv', 'status_change')
    and e.occurred_at >= now() - interval '30 days'
)
group by a.id, a.name, a.sector, a.company_id
order by fresh_signals desc, last_signal_at desc;

comment on view public.hot_accounts is
  'Comptes avec signal d''achat < 14 j sans prospect contacté < 30 j — la file d''or de la prospection. Lecture seule, zéro LLM.';
