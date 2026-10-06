# Pathélix

Plateforme SaaS multi-organisations de planification et d'optimisation de tournées, conçue
d'abord pour les loueurs de bennes et les collecteurs de déchets (pose, retrait, échange,
vidage à l'exutoire), et adaptable à cinq autres métiers de terrain (livraison, BTP & location,
déménagement, maintenance, coursier).

- **Exploitants** : missions, tournées optimisées en quelques secondes, ré-optimisation en
  cours de journée, suivi en direct, rapports.
- **Chauffeurs** : application mobile qui fonctionne sans réseau.
- **Conformité** : temps de conduite CE 561/2006 intégrés au calcul, bordereaux Trackdéchets.
- **Intégration** : API à clés et scopes, webhooks ERP/télématique, facturation Sage/SAP.

## Documentation

| Document | Contenu |
|---|---|
| [FEATURES.md](FEATURES.md) | Fonctionnalités par profil, optimisation, API et intégrations |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, organisation du code, modèle de données, moteur d'optimisation, temps réel, hors ligne |
| [OPERATIONS.md](OPERATIONS.md) | Déploiement Docker, configuration, workers, supervision, incidents, sauvegardes, Trackdéchets |
| [SECURITY.md](SECURITY.md) | Modèle de sécurité, contrôles, risques résiduels |
| `CLAUDE.md` | Consignes pour les sessions Claude Code sur ce dépôt |

## Démarrer en local

Prérequis : Node.js 20, PostgreSQL 16 ; Redis 7 et Valhalla optionnels (replis automatiques).

```bash
npm install
npx prisma generate
cp .env.example .env          # DATABASE_URL, SESSION_SECRET (≥ 32 car.), USE_MOCK_DATA=false
npx prisma migrate dev
npm run db:seed               # données de démonstration
npm run dev                   # http://localhost:3000
npm run worker                # optimisations asynchrones (optionnel en local)
```

Sans `USE_MOCK_DATA=false`, l'application tourne sur des données en mémoire (mode démo).
Production : `docker compose up -d` — voir OPERATIONS.md.

## Commandes

```bash
npm run dev | build | start
npm run lint                  # ESLint (interdit notamment l'accès Prisma non scopé)
npm run typecheck             # tsc --noEmit
npm test                      # Vitest
npx playwright test           # E2E — contre un build de production de préférence
npm run worker                # VRP ; aussi worker:pdf, worker:ml, worker:recurring, worker:retention
npx prisma migrate dev        # changement de schéma
npm run db:seed | db:seed-superadmin | db:seed-massive
```

## Tests

Vitest couvre le moteur d'optimisation (dont une vérification aléatoire que chaque delta de coût
égale la différence de deux coûts complets, et que toute mission d'entrée ressort exactement une
fois), les routes API, le middleware, l'isolation entre organisations et les correctifs de
sécurité. Playwright parcourt l'interface sur une vraie base.

Règles : ne jamais désactiver un test pour faire passer la suite ; un test qui échoue révèle un
bug ou un test qui figeait un mauvais comportement — corriger l'un ou l'autre, en le justifiant.

## Glossaire

| Terme | Sens |
|---|---|
| Organisation (tenant) | Entreprise cliente ; données isolées |
| Mission | Intervention : POSER, RETIRER, ECHANGER, CHARGER_IMMEDIAT, DEPLACER, TASSER, EXPEDIER, ALLER_RETOUR |
| VIDER / PAUSE | Étapes générées par l'optimiseur : passage à l'exutoire, pause réglementaire |
| Exutoire | Site de vidage (déchetterie, centre de tri) |
| Plan | Tournée d'un chauffeur pour une date |
| P1 | Mission urgente, servie avant son échéance |
| MV-ALNS | Méta-heuristique de l'optimiseur |
| `valhallaFactor` | Correction des temps de trajet (1,60 par défaut), calibrée par l'apprentissage |
