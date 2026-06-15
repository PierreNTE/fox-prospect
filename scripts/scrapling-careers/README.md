# POC Scrapling — collecteur de signaux « recrutement »

Test grandeur nature : **Scrapling surface-t-il des offres d'emploi IT/cyber que
la collecte actuelle (France Travail + `web_search` de Claude) rate ?**

Ce script tourne **en local** sur ta machine (pas sur Vercel — Vercel ne peut
pas faire tourner Python + un navigateur Chrome). Il scrape les pages carrières
de tes comptes suivis et écrit des signaux `recrutement` dans le **même Supabase**
que l'app, table `company_signals` — exactement comme le collecteur France Travail
([`lib/collect-france-travail.js`](../../lib/collect-france-travail.js)).

## Pourquoi ce POC

| | France Travail (actuel) | web_search Claude (actuel) | Scrapling (ce POC) |
|---|---|---|---|
| Couvre | offres déposées sur FT | tout le web, curé | pages carrières directes |
| Rate | les ATS privés (Workday…) | pages JS/anti-bot | rien si bon sélecteur |
| Coût | gratuit (API) | ~€0,01/recherche | gratuit (local) |
| Déterministe | oui | non | oui |

L'angle de Scrapling : les **portails carrières en JavaScript / derrière
Cloudflare** (Workday, SmartRecruiters…) que les deux autres sources lisent mal.

## Installation (Windows, une fois)

```powershell
cd scripts\scrapling-careers
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
scrapling install   # télécharge les navigateurs (Playwright)
```

> Python 3.10+ requis. Vérifie avec `python --version`.

## Lancement

Les secrets sont lus automatiquement depuis `../../.env.local` (le même fichier
que l'app : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). **Rien à recopier.**

```powershell
# DRY-RUN par défaut : affiche ce qu'il trouverait, n'écrit RIEN
python collect_careers.py

# Cibler un seul compte pour un test rapide
python collect_careers.py --account "Decathlon" --headful

# Écrire réellement les signaux dans Supabase
python collect_careers.py --commit --limit 20
```

| Option | Effet |
|---|---|
| _(défaut)_ | dry-run : aucune écriture, juste l'affichage |
| `--commit` | insère les signaux dans `company_signals` |
| `--limit N` | nombre max de comptes (défaut 10) |
| `--account "Nom"` | un seul compte (correspondance floue sur le nom) |
| `--headful` | navigateur visible, utile pour déboguer un site |

## Pré-requis côté données

`company_signals.company_id` est **NOT NULL** (clé vers la table `companies` /
SIREN). Le script ne traite donc que les comptes dont le `company_id` est résolu.
Si tu n'en as pas encore : page **Comptes → Base entreprises SIRENE → Importer**.

## Lire les résultats

- Page **Comptes** : les signaux remontent dans le score de chaleur.
- Supabase : `select * from company_signals where confidence = 0.8 order by created_at desc`
  (les signaux scrapés ont `confidence = 0.8`, ceux des API officielles `1.0`).

## Limites assumées (c'est un POC)

- **Sélecteurs génériques** : on extrait les intitulés depuis `<a>`, `<h1-4>`,
  `<li>` puis on filtre par mots-clés IT. Un vrai collecteur aurait des sélecteurs
  par plateforme (Workday a une structure stable, par ex.). C'est justement ce que
  le POC permet de jauger : le rendement vaut-il le coût d'un collecteur dédié ?
- **Découverte des pages carrières** par heuristique (chemins courants + scan des
  liens de la home). Certaines entreprises ont une URL exotique → faux négatifs.
- **Pas de cron** : lance-le à la main le soir. S'il fait ses preuves, on
  l'industrialise (ATS ciblés, planification locale, dédup plus fine).

## Verdict attendu

Après une nuit de test : si Scrapling remonte des offres IT que France Travail et
`web_search` n'avaient pas (surtout sur des ATS JS), sa puissance est justifiée
chez toi → on investit dans un collecteur dédié. Sinon, on garde les API
officielles et on a la réponse pour le prix d'un script jetable.
