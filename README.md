# Fox Prospect 🦊

Copilote de prospection B2B IT — **Sprint 1 : qualification + points d'accroche**.

Pour chaque prospect (DSI, RSSI, responsable infra…), l'app :
1. cherche sur le web l'actualité de l'entreprise et du contact (signaux d'achat : recrutements IT, levées, projets SI, nominations, NIS2/DORA…),
2. calcule un **score de fit** (0-100) avec justification,
3. propose **3 angles d'accroche** sourcés et datés,
4. génère des **brouillons** : email conforme prospection B2B, message LinkedIn < 280 caractères, points d'ouverture d'appel.

**L'envoi reste 100 % manuel** : tu relis, tu ajustes, tu envoies. C'est le design voulu (protection de ton compte LinkedIn, délivrabilité, qualité).

## Stack

Next.js 14 (App Router, JavaScript) · Supabase (base de données) · API Anthropic (`claude-sonnet-4-6` + web search) · Vercel (hébergement).

Coût de fonctionnement : ~0,02-0,05 € par prospect qualifié (recherche web + génération). Vercel et Supabase en free tier.

## Installation

### 1. Supabase (5 min)

1. Crée un projet sur [supabase.com](https://supabase.com) (free tier).
2. Ouvre **SQL Editor** → colle le contenu de `supabase/schema.sql` → Run.
3. Récupère dans **Project Settings → API** : l'URL du projet et la clé `service_role` (pas l'anon key — elle reste côté serveur uniquement).

### 2. Variables d'environnement

Copie `.env.example` vers `.env.local` et remplis :

| Variable | Où la trouver |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | idem (clé service_role) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `APP_USER` / `APP_PASSWORD` | à choisir — protège l'app par Basic Auth |
| `RESEARCH_MAX_SEARCHES` | optionnel (défaut : 4) — nb max de recherches web par qualification |
| `DAILY_RESEARCH_CAP` | optionnel (défaut : 50) — plafond de recherches par 24 h (sécurité budget) |

⚠️ **`APP_PASSWORD` est obligatoire en production** : sans lui, n'importe qui trouvant l'URL consomme ta clé API Anthropic.

### 3. En local

```bash
npm install
npm run dev
# → http://localhost:3000
```

### 4. Déploiement Vercel

1. Pousse le dossier sur un repo GitHub (privé).
2. Sur [vercel.com](https://vercel.com) → **Add New Project** → importe le repo (framework détecté : Next.js, rien à configurer).
3. Dans **Settings → Environment Variables**, ajoute les variables ci-dessus (les 5 obligatoires, plus `RESEARCH_MAX_SEARCHES` et `DAILY_RESEARCH_CAP` recommandées).
4. Deploy. Au premier accès, le navigateur demande utilisateur/mot de passe (Basic Auth).

Note : la recherche peut prendre 20-40 s. Les routes sont configurées avec `maxDuration = 60`, dans la limite du plan Hobby de Vercel. Le nombre de recherches web par qualification est plafonné par `RESEARCH_MAX_SEARCHES` (défaut : 4) ; **si des recherches tombent en 504, baisser à 3**. `DAILY_RESEARCH_CAP` (défaut : 50) limite le nombre de recherches par 24 h pour protéger le budget API.

## Utilisation type (la boucle quotidienne)

1. **Importer** : un contact à la main, ou un CSV collé (export Sales Navigator, liste SIRENE, fichier maison). Colonnes reconnues en FR/EN.
2. Ouvrir la fiche → **Lancer la recherche** → lire les signaux, le score, les angles.
3. **Générer les brouillons** → copier → personnaliser la dernière touche → envoyer depuis ta boîte / ton LinkedIn.
4. Mettre à jour le **statut** sur la piste (contacté → répondu → rdv) et noter les comptes-rendus.

Discipline qui fait le > 20 % de réponse : ne contacte que les fits ≥ 60, et seulement quand il y a au moins un signal daté de moins de 6 mois.

## Conformité (prospection B2B France)

L'app est conçue pour le régime B2B opt-out : emails professionnels uniquement, message en lien avec la fonction du contact, possibilité d'opposition dans chaque email (intégrée aux brouillons), **liste d'opposition permanente** (statut « opt-out » → l'email est bloqué à tout import futur).

À faire de ton côté : documenter une LIA (analyse d'intérêt légitime) simple, et traiter toute demande d'opposition sous 72 h via le statut opt-out.

Aucun scraping LinkedIn : la recherche s'appuie sur des sources web publiques via l'API.

## Sprint 2 — import LinkedIn, enrichissement, PWA

- **Import par URL LinkedIn** (page Importer) : colle l'URL d'un profil, l'app identifie la
  personne via le web public (pas de scraping LinkedIn) et pré-remplit le formulaire.
- **Enrichissement des coordonnées** (fiche prospect → Coordonnées → « Enrichir
  automatiquement ») : recherche du domaine email de l'entreprise, déduction du pattern
  public (prenom.nom@…), email candidat avec niveau de confiance et source, téléphone du
  standard. Jamais de mobile personnel, jamais d'écrasement d'un email saisi à la main.
- **PWA** : sur mobile, ouvre l'app dans le navigateur → menu → « Ajouter à l'écran
  d'accueil » (iPhone/Safari) ou « Installer l'application » (Android/Chrome). Interface
  Fluent Design avec barre d'onglets en bas sur mobile.
- Migration base nécessaire (une fois) : exécuter `supabase/migration-sprint2.sql` dans le
  SQL Editor. Icônes regénérables avec `node scripts/generate-icons.mjs`.

## Roadmap

- **Sprint 1** : import, recherche/qualification, score de fit, accroches, brouillons multi-canal, pipeline, opt-out.
- **Sprint 2 (ce repo)** : import par URL LinkedIn, enrichissement email/téléphone par recherche web, interface Fluent Design, PWA mobile.
- **Sprint 3** : sourcing automatique via l'API SIRENE (ciblage NAF/effectif/région), file de qualification en lot, envoi email réel (domaine dédié, SPF/DKIM/DMARC, warm-up, plafond/jour), séquences, tracking réponses — uniquement quand la qualité des messages est prouvée.

## Itérer sur la qualité

Toute la valeur est dans `lib/prompts.js`. Si les accroches sont trop génériques : ajoute des exemples de bons/mauvais messages dans le prompt de génération, précise ton offre dans les Réglages, ou augmente `RESEARCH_MAX_SEARCHES` (attention au timeout de 60 s sur Vercel Hobby).
