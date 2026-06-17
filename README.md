# Pathélix

SaaS B2B multi-tenant de gestion de flotte et d'optimisation de tournées.

## Documentation

| Document | Contenu |
|----------|---------|
| [docs/01_OVERVIEW.md](docs/01_OVERVIEW.md) | Présentation produit, secteurs, architecture, glossaire |
| [docs/02_FONCTIONNALITES.md](docs/02_FONCTIONNALITES.md) | Fonctionnalités par rôle (admin, chauffeur, superadmin) |
| [docs/03_TECHNIQUE.md](docs/03_TECHNIQUE.md) | Stack, modèle de données, sécurité, workers, VRP, ML |
| [docs/04_API_INTEGRATIONS.md](docs/04_API_INTEGRATIONS.md) | 119 routes API, webhooks, intégrations, variables d'env |
| [docs/05_EXPLOITATION.md](docs/05_EXPLOITATION.md) | Setup, déploiement, tests, dimensionnement, runbook |

### Références techniques détaillées

| Document | Contenu |
|----------|---------|
| [docs/ALGORITHM.md](docs/ALGORITHM.md) | Algorithme VRP MV-ALNS v6, système ML, performances |
| [docs/AI_ROADMAP.md](docs/AI_ROADMAP.md) | Feuille de route IA/ML (OCR, Copilot, parse-natural) |
| [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | Dimensionnement serveur, réseau, sauvegardes, runbook |

### Audit et qualité

| Document | Contenu |
|----------|---------|
| [RAPPORT_FINAL.md](RAPPORT_FINAL.md) | Rapport d'audit complet, gates CI, sécurité |
| [VALIDATION_TRACKDECHETS.md](VALIDATION_TRACKDECHETS.md) | Procédure HALT Trackdéchets |
| [COUVERTURE_ENDPOINTS.md](COUVERTURE_ENDPOINTS.md) | Matrice couverture 119 routes |
| [COUVERTURE_UI.md](COUVERTURE_UI.md) | Couverture 66 éléments UI |
| [NETTOYAGE.md](NETTOYAGE.md) | Rapport de nettoyage du code mort |

## Démarrage rapide

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev         # http://localhost:3000
npm run worker      # Worker BullMQ VRP (processus séparé)
```

Variables d'environnement requises : `DATABASE_URL`, `SESSION_SECRET`. Voir [docs/04_API_INTEGRATIONS.md](docs/04_API_INTEGRATIONS.md) section 5 pour la liste complète.

## Scripts

```bash
npm run dev            # Dev server
npm run test           # Vitest (179 fichiers, ~3250 tests)
npm run lint           # ESLint
npm run typecheck      # TypeScript strict
npm run build          # Build production
npm run worker         # Worker VRP
npm run worker:ml      # Worker ML (CRON nocturne)
npx prisma studio      # Interface DB
```
