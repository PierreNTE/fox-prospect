-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION v13 — Sources de presse (flux RSS / Atom)
--
-- Aucune modification de schéma : uniquement des lignes de configuration dans
-- veille_sources. C'est précisément ce pour quoi cette table a été conçue —
-- ajouter une source ne doit pas demander un déploiement.
--
-- Pourquoi la presse est nécessaire : mesuré sur données réelles, AUCUN des
-- 213 avis TED collectés ne correspond aux comptes suivis. TED est de la
-- commande publique, le portefeuille est composé de groupes privés. C'est la
-- presse qui allume les comptes existants — nominations, projets, incidents,
-- opérations financières.
--
-- Chaque flux ci-dessous a été VÉRIFIÉ le 24/07/2026 : il répond et renvoie
-- des entrées exploitables. Trois candidats ont été écartés à ce test :
--   · LeMagIT et Computerwoche → 404, url de flux disparue ;
--   · Usine Digitale → 403, l'éditeur refuse les robots. On ne contourne pas
--     un refus : la source est retirée, pas déguisée.
--
-- Conformité : on ne collecte que les métadonnées publiées dans le flux
-- (titre, résumé de l'éditeur, lien, date). Jamais le texte intégral, protégé
-- par le droit d'auteur. Le lien renvoie toujours vers l'éditeur.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.veille_sources (kind, label, url, country_code, config)
select v.kind, v.label, v.url, v.country_code, v.config::jsonb
from (values
  -- ── France ────────────────────────────────────────────────────
  ('rss', 'Le Monde Informatique',
   'https://www.lemondeinformatique.fr/rss/rss.xml', 'FR', '{"lang":"fr"}'),
  ('rss', 'ZDNet France',
   'https://www.zdnet.fr/feeds/rss/actualites/', 'FR', '{"lang":"fr"}'),
  ('rss', 'Silicon.fr',
   'https://www.silicon.fr/feed', 'FR', '{"lang":"fr"}'),
  -- ChannelNews suit l'écosystème des intégrateurs et revendeurs. Source
  -- montée en priorité après un constat de terrain : dans les attributions
  -- TED, ce sont les intégrateurs (Bechtle, CANCOM, SVA, Computacenter) qui
  -- gagnent, pas les constructeurs. L'intelligence canal vaut plus, pour un
  -- commercial constructeur, que la veille concurrentielle directe.
  ('rss', 'ChannelNews — écosystème partenaires',
   'https://www.channelnews.fr/feed', 'FR', '{"lang":"fr","angle":"canal"}'),

  -- ── Allemagne ─────────────────────────────────────────────────
  -- Seule couverture nationale du MVP allemand avec TED : faute de registre
  -- ouvert gratuit et de portail sous-seuil unifié, la presse porte l'essentiel.
  ('rss', 'heise online',
   'https://www.heise.de/rss/heise-atom.xml', 'DE', '{"lang":"de"}'),

  -- ── Royaume-Uni ───────────────────────────────────────────────
  ('rss', 'The Register',
   'https://www.theregister.com/headlines.atom', 'GB', '{"lang":"en"}'),
  ('rss', 'Computer Weekly',
   'https://www.computerweekly.com/rss/All-Computer-Weekly-content.xml', 'GB', '{"lang":"en"}')
) as v(kind, label, url, country_code, config)
where not exists (
  select 1 from public.veille_sources s where s.label = v.label
);


-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification :
--   select kind, count(*) from public.veille_sources
--    where enabled group by kind order by kind;
--   → attendu : emploi 2, registre 2, rss 7, ted 2, boamp 1, fts 1
-- ═══════════════════════════════════════════════════════════════════════════
