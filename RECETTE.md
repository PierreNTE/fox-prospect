# Recette de mise en production — Fox Prospect

Date : 12 juin 2026 · Réalisée par Claude (mission « finalisation production ») avec validations de Pierre.
Production : https://fox-prospect.vercel.app · Dépôt : https://github.com/PierreNTE/fox-prospect (privé)

## Volet A — Correctifs code

| # | Vérification | Statut |
|---|---|---|
| A1 | `maxSearches` lu depuis `RESEARCH_MAX_SEARCHES` (défaut 4) | ✅ |
| A1 | Variable documentée (`.env.example`, README, consigne « 504 → baisser à 3 ») | ✅ |
| A2 | Opt-out sans email → 400 « Renseigne d'abord l'email du contact… » | ✅ |
| A2 | Dashboard : erreurs API affichées dans le bandeau `.alert-err` | ✅ |
| A2 | Bonus : édition de l'email sur la fiche prospect (champ + PATCH) | ✅ |
| A3 | Plafond quotidien `DAILY_RESEARCH_CAP` (défaut 50) → 429 | ✅ |
| — | `npm run build` sans erreur ni warning nouveau | ✅ |
| — | Commit `fix: garde-fous production…` (`84b848c`) | ✅ |

## Volet B — Déploiement

| # | Vérification | Statut |
|---|---|---|
| B1 | Dépôt git initialisé, 2 commits propres, `.env.local` ignoré | ✅ |
| B1 | Dépôt GitHub privé créé (`gh repo create`), `main` poussée | ✅ |
| B2 | Schéma SQL exécuté dans Supabase (« Success. No rows returned ») — RLS actif sur les 5 tables | ✅ |
| B3 | 7 variables d'environnement en Production via `vercel env add --value` | ✅ |
| B4 | Plafond de dépense Anthropic : 5 USD de crédits prépayés (coupure automatique à épuisement) | ✅ |
| B5 | `vercel --prod` : déploiement OK | ✅ |
| B5 | URL sans identifiants → **401** | ✅ |
| B5 | URL avec identifiants → **200** | ✅ |
| B5 | `Authorization: Basic garbage!!!` → **401** (pas 500, correctif atob OK) | ✅ |

## Volet C — Tests de bout en bout

| # | Vérification | Résultat | Statut |
|---|---|---|---|
| C1 | `npm install` + `npm run build` | Sans erreur | ✅ |
| C1 | `extractJson` : 8 cas (5 succès, 3 erreurs propres « Pas de JSON trouvé ») | 8/8 conformes, script supprimé | ✅ |
| C2 | Import manuel d'1 prospect | `inserted: 1` | ✅ |
| C2 | Import CSV 3 lignes | `inserted: 3` | ✅ |
| C2 | Réimport du même CSV | « Aucun nouveau prospect : 3 doublon(s) déjà sur la piste. » | ✅ |
| C2 | CSV en-têtes inconnus (test UI par Pierre) | Bandeau d'aide « Aucune ligne reconnue… », pas d'écran vide | ✅ |
| C3 | Recherche réelle (C. Daudruy, U Tech / Coopérative U) | **63 s**, HTTP 200, score 72 justifié, 6 signaux datés et sourcés, 8 sources | ✅ |
| C4 | Génération des brouillons | 15 s ; ligne d'opposition présente dans l'email ; LinkedIn **237 caractères** (≤ 280) | ✅ |
| C5 | Opt-out d'un prospect avec email | 200, ligne créée dans `optout` | ✅ |
| C5 | Réimport d'un email opt-out | Bloqué (400, « opt-out exclus ») | ✅ |
| C5 | Opt-out d'un prospect sans email (API + UI) | 400, message clair affiché dans le bandeau | ✅ |
| C6 | Plafond quotidien (`DAILY_RESEARCH_CAP=1` temporaire) | 429 immédiat, message exact, aucun crédit API consommé ; remis à 50 ensuite | ✅ |

### Durées mesurées

| Opération | Durée | Limite |
|---|---|---|
| Recherche web (4 puis 3 searches, 1ʳᵉ tentative à `maxDuration=60`) | 61 s → **504** | 60 s ❌ |
| Recherche web (après passage à `maxDuration=120`) | **63 s** → 200 | 120 s ✅ |
| Génération des brouillons | **15 s** | 120 s ✅ |
| Réponse 429 du plafond | < 1 s | — ✅ |

## Anomalies relevées

| Anomalie | Criticité | État / action |
|---|---|---|
| **504 sur la recherche** : la requête complète prend ~60-90 s, le `maxDuration=60` initial tuait la fonction même avec `RESEARCH_MAX_SEARCHES=3`. | Haute | **Corrigée** : `maxDuration=120` (Fluid Compute, autorisé en Hobby) — commit `7aa8fef`. `RESEARCH_MAX_SEARCHES` remis à 4. Si lenteurs : baisser à 3. |
| Durée de recherche (63 s) au-dessus de la cible initiale de 50 s. | Faible | Acceptable avec la marge à 120 s. La cible < 50 s était liée à l'ancienne limite de 60 s. |
| `next@14.2.15` signalé vulnérable au build (correctif de déc. 2025, voir nextjs.org/blog/security-update-2025-12-11). | Moyenne | **À arbitrer** : monter vers le dernier patch 14.2.x (changement mineur, hors périmètre mission « aucune nouvelle dépendance » — à confirmer par Pierre). L'app étant derrière Basic Auth et mono-utilisateur, l'exposition est réduite. |
| Vercel ↔ GitHub non connectés (« Login Connection » absente sur le compte Vercel) : pas de déploiement auto au push, uniquement `npx vercel --prod`. | Faible | Optionnel : connecter GitHub dans Vercel → Settings → Git. |
| Réglages (`/settings`) vides → brouillons signés « Le commercial » et ciblage de l'offre générique. | Faible | Action Pierre : remplir nom, rôle, société et offre. |
| Pipe PowerShell → `npx vercel env add` : valeurs stockées vides ou avec `\r` parasite (cause du premier échec d'authentification Basic). | — (incident de procédure, résolu) | Toujours utiliser `vercel env add --force --value '...'`. |

## Souhaits produit notés (hors périmètre de cette recette)

- **Import par URL LinkedIn + enrichissement automatique des coordonnées (email, téléphone)** : demandé par Pierre en cours de recette. Correspond au Sprint 2 de la roadmap (cascade d'enrichissement email). Attention : pas de scraping LinkedIn (CGU + risque sur le compte) ; passer par recherche web publique et déduction de pattern d'email.

## Verdict

# ✅ GO pour l'utilisation quotidienne

L'application est en production, protégée (Basic Auth vérifiée, RLS Supabase, clés côté serveur uniquement), bordée en coût (plafond applicatif 50 recherches/jour + crédits prépayés Anthropic), et le parcours complet import → recherche → brouillons → opt-out fonctionne sur un prospect réel avec des signaux datés, sourcés et un score justifié.

Conditions d'exploitation :
1. Ne contacter que les fits ≥ 60 avec un signal < 6 mois (discipline du README).
2. Remplir `/settings` avant les premiers envois réels.
3. Traiter toute demande d'opposition sous 72 h via le statut opt-out (penser à renseigner l'email du contact d'abord).
4. Surveiller la consommation sur console.anthropic.com les premières semaines (~0,03-0,05 €/prospect qualifié observé).
