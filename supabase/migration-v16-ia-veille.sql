-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION v16 — Étage IA du module de veille (livrable 7)
--
-- Idempotente : réexécutable sans effet de bord.
-- Dépend de v12 (pgvector, signal_embeddings, veille_documents).
--
-- Ce que cette migration installe, et pourquoi :
--
--  1. Trois colonnes de JUGEMENT sur company_signals. Le verdict du modèle est
--     stocké À CÔTÉ du signal, jamais à la place : `detail` reste le texte de
--     la source, `summary` est la reformulation française. Un jour où le
--     jugement se révèle mauvais, on efface une colonne — on ne réécrit pas
--     l'historique de la source.
--
--  2. Une table de THÈMES vectorisés. C'est ce qui rend la recherche
--     sémantique possible sans service d'embedding en ligne : l'application
--     tourne sur Vercel et ne peut pas faire tourner BGE-M3, mais elle peut
--     comparer des vecteurs déjà calculés. Un thème est donc une requête
--     PRÉ-VECTORISÉE par le passage quotidien.
--
--  3. Trois fonctions SQL. La similarité vit en base, au contact de l'index
--     HNSW ; ni Python ni Next.js ne rapatrient de vecteurs.
--
-- RLS : les tables créées suivent la convention du schéma (activée, sans
-- policy — seul le service_role accède).
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- 1. company_signals — trace du jugement
-- ─────────────────────────────────────────────────────────────
-- `summary` : une à deux phrases en français, y compris pour un avis allemand
-- ou anglais. La traduction est un effet de bord du résumé et non une étape
-- séparée : demander deux fois au modèle ce qu'il peut faire en une passe
-- doublerait le coût pour le même résultat.
--
-- `relevance` : ce que le modèle pense de la pertinence commerciale (0-1).
-- Distinct de `confidence` (fiabilité de la SOURCE) et de `match_confidence`
-- (fiabilité du RATTACHEMENT). Trois incertitudes différentes, trois colonnes :
-- les confondre reviendrait à présenter un doute de rattachement comme un
-- doute d'intérêt commercial.

alter table public.company_signals
  add column if not exists summary      text,
  add column if not exists relevance    numeric(3,2) check (relevance between 0 and 1),
  add column if not exists judged_model text,
  add column if not exists judged_at    timestamptz;

comment on column public.company_signals.summary is
  'Résumé français « pourquoi maintenant », produit par le modèle. Le texte de source reste dans detail.';
comment on column public.company_signals.relevance is
  'Pertinence commerciale jugée par le modèle (0-1). À ne pas confondre avec match_confidence (rattachement).';
comment on column public.company_signals.judged_at is
  'Date du passage LLM. NULL = signal non jugé (plafond atteint ou rattachement déjà certain).';


-- ─────────────────────────────────────────────────────────────
-- 2. veille_themes — requêtes sémantiques pré-vectorisées
-- ─────────────────────────────────────────────────────────────
-- Un thème est une phrase de recherche écrite en français, vectorisée une fois
-- par le passage quotidien, et comparée ensuite à tous les signaux — quelle que
-- soit LEUR langue. C'est là que le choix d'un modèle multilingue (BGE-M3)
-- paie : « renouvellement de parc PC » rapproche un avis allemand parlant de
-- « Beschaffung von Notebooks » sans qu'aucune traduction n'ait eu lieu.
--
-- `embedding` est nullable : un thème ajouté aujourd'hui est vectorisé au
-- prochain passage. Entre les deux, il n'apparaît simplement pas dans
-- l'interface — pas d'erreur, pas de résultat faux.

create table if not exists public.veille_themes (
  id          bigint generated always as identity primary key,
  label       text not null unique,
  query       text not null,
  enabled     boolean not null default true,
  embedding   halfvec(1024),
  embedded_at timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.veille_themes is
  'Requêtes sémantiques pré-vectorisées. Vercel ne peut pas embarquer un modèle : les vecteurs sont calculés par le passage quotidien.';
comment on column public.veille_themes.query is
  'Phrase de recherche. La reformuler invalide le vecteur : remettre embedding à NULL après modification.';

alter table public.veille_themes enable row level security;

-- Le vecteur d'un thème dont la requête change doit être recalculé. Le trigger
-- évite d'avoir à y penser à chaque modification depuis l'éditeur Supabase.
create or replace function public.veille_themes_invalider_vecteur()
returns trigger
language plpgsql
as $$
begin
  if new.query is distinct from old.query then
    new.embedding := null;
    new.embedded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists veille_themes_query_maj on public.veille_themes;
create trigger veille_themes_query_maj
  before update on public.veille_themes
  for each row execute function public.veille_themes_invalider_vecteur();


-- Thèmes initiaux : la taxonomie Dell, exprimée en langage naturel plutôt
-- qu'en mots-clés. Un embedding travaille sur du sens ; une liste de termes
-- séparés par des virgules produit un vecteur moyen qui ne ressemble à rien.
insert into public.veille_themes (label, query)
select v.label, v.query
from (values
  ('Renouvellement de parc',
   'Renouvellement du parc de postes de travail : migration vers Windows 11, achat d''ordinateurs portables et de stations de travail pour les collaborateurs.'),
  ('Datacenter & stockage',
   'Modernisation d''un centre de données : achat de serveurs, de baies de stockage, virtualisation, refonte de la salle informatique.'),
  ('IA & calcul GPU',
   'Projet d''intelligence artificielle nécessitant du calcul intensif : serveurs GPU, cluster de calcul haute performance, infrastructure pour modèles de langage.'),
  ('Nomination informatique',
   'Nomination d''un dirigeant informatique : nouveau directeur des systèmes d''information, arrivée d''un responsable de la sécurité, changement de directeur technique.'),
  ('Mouvement concurrent',
   'Un concurrent remporte un marché informatique ou signe un partenariat d''infrastructure : HPE, Lenovo, HP Inc.'),
  ('Cybersécurité',
   'Incident de sécurité informatique ou mise en conformité : cyberattaque, rançongiciel, directive NIS2, audit de sécurité.')
) as v(label, query)
where not exists (
  select 1 from public.veille_themes t where t.label = v.label
);


-- ─────────────────────────────────────────────────────────────
-- 3. Signaux restant à vectoriser
-- ─────────────────────────────────────────────────────────────
-- Une anti-jointure, que l'API REST ne sait pas exprimer. La renvoyer sous
-- forme de fonction évite au pipeline de rapatrier tous les identifiants pour
-- faire la différence en Python.
--
-- Les plus RÉCENTS d'abord : si le plafond de temps est atteint, mieux vaut
-- avoir vectorisé ce qui s'affiche que le fond d'historique.

create or replace function public.veille_signaux_sans_embedding(p_limite int default 200)
returns table (id bigint, texte text)
language sql
stable
as $$
  select s.id,
         concat_ws(' — ', nullif(s.title, ''), nullif(coalesce(s.summary, s.detail), ''))
  from public.company_signals s
  left join public.signal_embeddings e on e.signal_id = s.id
  where e.signal_id is null
    and (coalesce(s.title, '') <> '' or coalesce(s.detail, '') <> '')
  order by s.observed_at desc nulls last, s.id desc
  limit greatest(p_limite, 0);
$$;

comment on function public.veille_signaux_sans_embedding is
  'Signaux à vectoriser, les plus récents d''abord. Anti-jointure inexprimable via PostgREST.';


-- ─────────────────────────────────────────────────────────────
-- 4. Signaux proches d'un signal donné
-- ─────────────────────────────────────────────────────────────
-- Recherche sémantique SANS requête textuelle : le vecteur de départ est celui
-- d'un signal déjà en base. C'est la seule forme de recherche vectorielle que
-- l'application puisse offrir en direct, faute de pouvoir embarquer un modèle
-- côté Vercel — et c'est aussi la plus utile au quotidien : « ce marché
-- ressemble-t-il à quelque chose que j'ai déjà vu ailleurs ? ».

-- `create or replace` ne sait pas modifier les COLONNES DE SORTIE d'une
-- fonction : toute évolution de la table renvoyée exige une suppression
-- préalable. Sans ce drop, réappliquer la migration après avoir ajouté une
-- colonne échoue avec « cannot change return type ».
drop function if exists public.veille_signaux_proches(bigint, int, float);

create or replace function public.veille_signaux_proches(
  p_signal_id bigint,
  p_limite    int   default 5,
  p_seuil     float default 0.55
)
returns table (
  id             bigint,
  account_id     uuid,
  account_name   text,
  type           text,
  product_line   text,
  title          text,
  summary        text,
  observed_at    date,
  source_url     text,
  match_method   text,
  match_confidence numeric(3,2),
  relevance      numeric(3,2),
  similarite     float
)
language sql
stable
as $$
  with depart as (
    select embedding from public.signal_embeddings where signal_id = p_signal_id
  )
  select s.id, s.account_id, a.name, s.type, s.product_line, s.title, s.summary,
         s.observed_at, s.source_url, s.match_method, s.match_confidence, s.relevance,
         1 - (e.embedding <=> depart.embedding) as similarite
  from depart
  join public.signal_embeddings e on true
  join public.company_signals   s on s.id = e.signal_id
  left join public.accounts     a on a.id = s.account_id
  where e.signal_id <> p_signal_id
    and 1 - (e.embedding <=> depart.embedding) >= p_seuil
  order by e.embedding <=> depart.embedding
  limit greatest(p_limite, 0);
$$;

comment on function public.veille_signaux_proches is
  'Signaux sémantiquement proches d''un signal. Le vecteur de départ vient de la base : aucun modèle n''est requis côté application.';


-- ─────────────────────────────────────────────────────────────
-- 5. Signaux correspondant à un thème
-- ─────────────────────────────────────────────────────────────
-- Le pendant « requête » de la fonction précédente. Le seuil par défaut est
-- plus bas : comparer une phrase de recherche à un titre d'avis produit des
-- similarités structurellement plus faibles que comparer deux titres entre eux.

drop function if exists public.veille_signaux_par_theme(bigint, int, float);

create or replace function public.veille_signaux_par_theme(
  p_theme_id bigint,
  p_limite   int   default 30,
  p_seuil    float default 0.45
)
returns table (
  id             bigint,
  account_id     uuid,
  account_name   text,
  type           text,
  product_line   text,
  title          text,
  summary        text,
  observed_at    date,
  source_url     text,
  match_method   text,
  match_confidence numeric(3,2),
  relevance      numeric(3,2),
  similarite     float
)
language sql
stable
as $$
  with theme as (
    select embedding from public.veille_themes
    where id = p_theme_id and embedding is not null
  )
  select s.id, s.account_id, a.name, s.type, s.product_line, s.title, s.summary,
         s.observed_at, s.source_url, s.match_method, s.match_confidence, s.relevance,
         1 - (e.embedding <=> theme.embedding) as similarite
  from theme
  join public.signal_embeddings e on true
  join public.company_signals   s on s.id = e.signal_id
  left join public.accounts     a on a.id = s.account_id
  where 1 - (e.embedding <=> theme.embedding) >= p_seuil
  order by e.embedding <=> theme.embedding
  limit greatest(p_limite, 0);
$$;

comment on function public.veille_signaux_par_theme is
  'Signaux proches d''un thème pré-vectorisé. Multilingue : un thème français rapproche un avis allemand.';


-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification post-migration (à exécuter séparément) :
--
--   select count(*) from public.veille_themes;                  -- 6 attendus
--   select count(*) from public.veille_signaux_sans_embedding(500);
--   select column_name from information_schema.columns
--     where table_name = 'company_signals' and column_name = 'summary';
-- ═══════════════════════════════════════════════════════════════════════════
