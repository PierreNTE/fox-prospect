-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION v14 — Flux de veille rattachés à un compte
--
-- Le problème mesuré
-- ──────────────────
-- Sur 7 jours, 328 articles de presse IT généraliste ne citent que 3 des
-- comptes suivis, pour 1 seul signal retenu. La presse généraliste parle de
-- technologies et de fournisseurs, presque jamais des grands comptes
-- nommément. Le rattachement s'y fait par RECHERCHE DE NOM dans le texte —
-- la méthode la moins fiable de la cascade, et celle qui a produit cinq faux
-- rattachements sur six lors du premier essai (« La Poste » confondu avec
-- « poste de travail »).
--
-- Ce que change ce rattachement
-- ─────────────────────────────
-- La salle de presse d'une entreprise ne parle que d'elle. Quand la SOURCE
-- désigne le compte, il n'y a plus de recherche de nom, donc plus aucun faux
-- positif possible : la confiance est structurelle, pas statistique.
--
-- C'est aussi le prérequis de la trajectoire SaaS : chaque utilisateur pourra
-- attacher ses propres flux à ses propres comptes, sans déploiement.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.veille_sources
  add column if not exists account_id uuid
    references public.accounts(id) on delete cascade;

comment on column public.veille_sources.account_id is
  'Si renseigné, tout document de cette source est rattaché à CE compte, '
  'sans recherche de nom. Sinon, source généraliste : rattachement par mention.';

-- Partiel : la grande majorité des sources restent généralistes.
create index if not exists veille_sources_account_idx
  on public.veille_sources (account_id) where account_id is not null;


-- ─────────────────────────────────────────────────────────────
-- Flux découverts et VALIDÉS le 24/07/2026
-- ─────────────────────────────────────────────────────────────
-- Produits par veille/decouvrir_flux.py, qui lit la balise <link rel="alternate">
-- puis les liens « RSS » des pages, et ne retient un flux qu'après l'avoir
-- effectivement parsé (il répond, il contient des entrées datées).
--
-- 5 comptes sur 30 seulement. Ce n'est pas un défaut de l'outil : 25 de ces
-- groupes ne publient plus AUCUN flux détectable — les CMS d'entreprise
-- modernes ont abandonné RSS. Les équiper demandera soit une URL fournie à la
-- main, soit une autre source (le pipeline analyzeAccount existant les couvre
-- déjà partiellement via accounts.news).

insert into public.veille_sources (kind, label, url, country_code, account_id, config)
select v.kind, v.label, v.url, v.country_code, v.account_id::uuid, v.config::jsonb
from (values
  ('rss', 'Atos — salle de presse',
   'https://atos.net/rss', 'FR',
   '11585628-1ef3-4018-9627-df03eaf6817c', '{"portee":"compte","lang":"fr"}'),

  ('rss', 'AXA — salle de presse',
   'https://axa.com/rss', 'FR',
   'c24cf07d-71be-4496-814f-cc0668dd49a9', '{"portee":"compte","lang":"fr"}'),

  -- « A la une », pas « Tendances Eco » : le groupe expose deux flux sous des
  -- identifiants voisins (183812 / 183813), le second étant de la recherche
  -- macro-économique sans valeur commerciale.
  ('rss', 'Crédit Agricole — A la une',
   'https://www.credit-agricole.com/rss_flux/183812', 'FR',
   '8596496e-1767-43c0-b84e-065c94de8ed6', '{"portee":"compte","lang":"fr"}'),

  -- Version française retenue : le groupe publie les mêmes communiqués en six
  -- langues, et la découverte tombait d'abord sur l'italien.
  ('rss', 'Stellantis — communiqués de presse',
   'https://www.stellantis.com/fr/actualite/communiques-de-presse.rss.xml', 'FR',
   'e419b4f4-d6f2-4ab4-91bb-a88f69bad745', '{"portee":"compte","lang":"fr"}'),

  ('rss', 'TotalEnergies — newsroom',
   'https://totalenergies.com/newsroom/feed/', 'FR',
   '8ec098ac-1881-432e-aac1-9a3cefba7649', '{"portee":"compte","lang":"fr"}')
) as v(kind, label, url, country_code, account_id, config)
where not exists (
  select 1 from public.veille_sources s where s.url = v.url
);


-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification :
--   select s.label, a.name
--     from public.veille_sources s
--     join public.accounts a on a.id = s.account_id
--    order by a.name;
--   → attendu : 5 lignes (Atos, AXA, Crédit Agricole, Stellantis, TotalEnergies)
-- ═══════════════════════════════════════════════════════════════════════════
