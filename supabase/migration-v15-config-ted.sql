-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION v15 — Configuration TED conforme à l'API
--
-- Aucune modification de schéma : uniquement de la configuration.
--
-- La configuration posée en v12 déclarait `cpv_prefixes: ["30","48","51","72"]`
-- et `notice_types: ["cn"]`. Or l'API TED rejette les préfixes CPV — elle exige
-- des codes COMPLETS à 8 chiffres — et attend « cn-standard », pas « cn ».
--
-- Le connecteur tolère les deux formes et se rabat sur ses valeurs par défaut,
-- en imprimant un avertissement à chaque passage. Il fonctionne donc, mais la
-- configuration affichée MENT sur ce qui est réellement collecté : quelqu'un
-- qui lit ces lignes croit filtrer sur quatre familles CPV. On aligne la
-- configuration sur la réalité plutôt que d'entretenir l'écart.
--
-- Les codes retenus couvrent le périmètre Dell : matériel et postes de travail
-- (CSG), serveurs et stockage (ISG), logiciels et services d'infogérance.
-- ═══════════════════════════════════════════════════════════════════════════

update public.veille_sources
set config = jsonb_build_object(
  'cpv_codes', jsonb_build_array(
    '30200000',   -- matériel informatique
    '30213000',   -- ordinateurs personnels et portables
    '30233000',   -- supports de stockage
    '48000000',   -- logiciels
    '48800000',   -- systèmes d'information
    '48820000',   -- serveurs
    '72000000',   -- services informatiques
    '72500000'    -- services d'infogérance
  ),
  'notice_types', jsonb_build_array('cn-standard')
)
where kind = 'ted' and label = 'TED — avis de marché IT';

update public.veille_sources
set config = jsonb_build_object(
  'cpv_codes', jsonb_build_array(
    '30200000', '30213000', '30233000', '48000000',
    '48800000', '48820000', '72000000', '72500000'
  ),
  'notice_types', jsonb_build_array('can-standard'),
  -- Conservé : marque l'usage de veille concurrentielle de cette source.
  'veille_concurrentielle', true
)
where kind = 'ted' and label = 'TED — avis d''attribution';


-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification : le passage suivant ne doit plus imprimer
--   « cpv_prefixes ignoré : TED exige des codes complets »
--
--   select label, config from public.veille_sources where kind = 'ted';
-- ═══════════════════════════════════════════════════════════════════════════
