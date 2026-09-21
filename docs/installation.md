# Pathélix — Installation

> Prérequis, installation, lancement en local, commandes disponibles.
> Vérifié contre le code réel le 2026-09-21. Variables d'environnement complètes :
> [configuration.md](configuration.md). Build/déploiement : [deploiement.md](deploiement.md).

## 1. Prérequis

| Composant | Version minimale |
|-----------|-----------------|
| Node.js | ≥ 18.17 |
| npm | ≥ 10 |
| PostgreSQL | 16 |
| Redis | 7 (optionnel — fallback in-memory) |
| Valhalla | Auto-hébergé (optionnel — fallback haversine) |

## 2. Installation

> **Nom du dossier vs nom du package** : le dossier local du dépôt est `projet_clem`, le
> package npm est `"pathelix"` dans `package.json` — c'est intentionnel, pas une erreur à
> corriger.

```bash
git clone <repo>
cd projet_clem
npm install
npx prisma generate
```

Copier `.env.example` vers `.env` et renseigner au minimum `DATABASE_URL` et `SESSION_SECRET`.
Liste complète des variables : [configuration.md](configuration.md).

## 3. Démarrage

```bash
npm run dev              # Next.js sur :3000
npm run worker           # Worker BullMQ VRP (processus séparé)
npm run worker:ml        # Worker ML nocturne (optionnel)
npm run worker:recurring # Worker missions récurrentes (optionnel)
```

Ordre recommandé : PostgreSQL → Redis → Next.js → Worker VRP → Worker ML → Valhalla
(optionnel).

### Premier démarrage

```bash
npx prisma migrate dev
npm run db:seed                # Données de test réalistes
npm run db:seed-superadmin     # Requiert SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
```

## 4. Commandes disponibles

```bash
npm run dev                    # Dev server (localhost:3000)
npm run dev:turbo              # Dev server avec Turbopack
npm run build                  # Build production
npm run start                  # Serveur production (après build)
npm run lint                   # ESLint (next lint — déprécié, voir note ci-dessous)
npm run typecheck              # tsc --noEmit
npm run test                   # Vitest (run unique)
npm run test:watch             # Vitest mode watch
npm run test:coverage          # Vitest avec couverture
npm run test:e2e               # Playwright (serveur requis)
npm run worker                 # Worker BullMQ VRP
npm run worker:ml              # Worker ML nocturne
npm run worker:recurring       # Worker missions récurrentes
npx prisma migrate dev         # Appliquer les migrations (dev)
npx prisma generate            # Régénérer le client Prisma
npm run db:seed                # Données de démo réalistes
npm run db:seed-massive        # Volume important (tests de charge)
npm run db:seed-superadmin     # Compte superadmin uniquement
npx prisma studio              # GUI base de données
```

> **Note (2026-09-21)** : `next lint` affiche un avertissement de dépréciation (retrait prévu
> avec Next.js 16). Migration recommandée : `npx @next/codemod@canary
> next-lint-to-eslint-cli .`. Non fait cette session (0 impact fonctionnel actuel), à planifier
> avant toute montée vers Next 16 — voir [deploiement.md](deploiement.md).

## 5. Base de test dédiée pour toute session de test manuel

Ne jamais faire tourner un test manuel exploratoire, un import massif ou un script contre la
base de démo/pilote référencée par `DATABASE_URL` en environnement de développement partagé.
Utiliser une base isolée (nom sans substring commun avec le nom de la base réelle, ex.
`manualtest_sandbox_never_prod`) et passer par `scripts/db-guard.sh`, qui refuse d'exécuter
toute commande si `DATABASE_URL` n'est pas explicitement exportée ou si le nom résolu ne
contient pas le marqueur attendu :

```bash
export DATABASE_URL=$(grep '^DATABASE_URL=' .env.production.local | cut -d= -f2-)
scripts/db-guard.sh npx tsx prisma/seed-superadmin.ts
```
