# Pathélix

> SaaS B2B multi-tenant de gestion de flotte et d'optimisation de tournées.
> Documentation vérifiée contre le code source réel (2026-09-21).

---

## Table des matières

La documentation complète vit dans [`docs/`](docs/) :

1. **README.md** (ce fichier) — vue d'ensemble produit, architecture, rôles, glossaire
2. **[docs/architecture.md](docs/architecture.md)** — stack technique, arborescence, flux de données, workers
3. **[docs/installation.md](docs/installation.md)** — prérequis, installation, commandes
4. **[docs/configuration.md](docs/configuration.md)** — toutes les variables d'environnement
5. **[docs/base-de-donnees.md](docs/base-de-donnees.md)** — schéma, modèles, migrations
6. **[docs/api.md](docs/api.md)** — routes API, webhooks, intégrations externes
7. **[docs/fonctionnalites.md](docs/fonctionnalites.md)** — fonctionnalités détaillées par rôle
8. **[docs/authentification-securite.md](docs/authentification-securite.md)** — auth, permissions, invariants de sécurité, risques résiduels
9. **[docs/tests.md](docs/tests.md)** — organisation des tests, comment les lancer, ce qui n'est pas couvert
10. **[docs/deploiement.md](docs/deploiement.md)** — build, déploiement, runbook d'incidents, HALT Trackdéchets
11. **[docs/audit-2026-09-21.md](docs/audit-2026-09-21.md)** — synthèse de l'audit complet le plus récent

`CLAUDE.md` (racine) est un fichier séparé — instructions opérationnelles pour les sessions
Claude Code, pas de la documentation produit. Il n'est pas remplacé par ces fichiers.

---

## 1. Qu'est-ce que Pathélix ?

Pathélix est un **SaaS B2B multi-tenant** de gestion de flotte et d'optimisation de tournées. Il s'adresse aux entreprises opérant une flotte de véhicules utilitaires pour des missions terrain répétitives : collecte, livraison, maintenance, déménagement, BTP, coursier.

La plateforme couvre l'intégralité du cycle opérationnel :

- **Planification** : création et gestion des missions, clients, sites, véhicules, chauffeurs
- **Optimisation** : algorithme VRP multi-objectifs (MV-ALNS v6) produisant des tournées journalières optimales en 5–120 secondes
- **Exécution terrain** : interface mobile chauffeur (tournée du jour, navigation turn-by-turn, mise à jour de statut, photo de preuve)
- **Suivi temps réel** : positions GPS, statuts chauffeurs en direct via SSE + Redis Pub/Sub
- **Analyse** : KPI, rapports CO2, historique, prédictions ML de durée d'intervention
- **Conformité** : pauses réglementaires CE 561/2006 insérées automatiquement, traçabilité Trackdéchets (BSDD)

## 2. Problème résolu

Les entreprises de terrain gèrent leurs tournées manuellement ou avec des outils génériques inadaptés. Les conséquences : kilomètres superflus, retards clients, planificateurs surchargés, données terrain disparates.

Pathélix automatise la décision de tournée avec un algorithme qui tient compte simultanément de :

- La **géographie et les distances réelles** (profil poids-lourds via Valhalla/Trimble/HERE)
- Les **fenêtres horaires clients** (VRPTW)
- La **capacité des véhicules** (bennes en m³, flotte hétérogène)
- Les **priorités de mission** (P1 toujours affectées, même au détriment de l'équilibre)
- L'**historique terrain** (coefficients ML par chauffeur × site × type de mission)
- La **réglementation du travail** (pauses CE 561/2006, max 10h/jour)

## 3. Six secteurs d'activité

Pathélix s'adapte au vocabulaire de chaque secteur via le champ `trade` du tenant :

| Trade | Secteur | Terminologie adaptée |
|-------|---------|---------------------|
| `collecte_recyclage` | Collecte & Recyclage | Bennes, exutoires, BSDD, vidages |
| `livraison_distribution` | Livraison & Distribution | Colis, tournées, livraisons, retours |
| `btp_location` | BTP & Location | Engins, dépôts, chantiers, matériel |
| `demenagement` | Déménagement | Meubles, camions, équipes, encombrants |
| `maintenance_sav` | Maintenance & SAV | Interventions, pièces, techniciens |
| `coursier_express` | Coursier & Express | Colis urgents, relais, livraisons express |

Les labels UI (missions, véhicules, sites…) changent dynamiquement selon le trade du tenant (`src/lib/trades.ts`, `TradeProvider`). Des trades personnalisés au-delà de ces 6 peuvent être créés par un superadmin (registre server-only, voir docs/architecture.md).

## 4. Architecture globale

Pathélix fonctionne sur un **serveur cloud dédié unique**. Tous les services communiquent via un réseau bridge Docker interne — pas de cluster distribué (voir docs/architecture.md pour les implications sur le cache/rate-limiting en mémoire).

```
Internet (HTTPS)
      │
      ▼
┌────────────────────────────────────────────────────────────┐
│  SERVEUR CLOUD DÉDIÉ                                        │
│                                                              │
│  ┌───────────┐  ┌────────────┐  ┌───────┐                   │
│  │  Next.js  │  │ PostgreSQL │  │ Redis │                   │
│  │  (App)    │  │   (Data)   │  │(Queue)│                   │
│  └─────┬─────┘  └─────┬──────┘  └───┬───┘                   │
│        │               │             │                       │
│        └───────────────┴─────────────┘                       │
│                   Bridge Docker (< 1ms)                      │
│        ┌───────────────┬─────────────┐                       │
│        ▼               ▼             ▼                       │
│  ┌──────────┐  ┌────────────┐  ┌─────────────────────┐       │
│  │ Valhalla │  │ Worker VRP │  │ AI Engine (partiel) │       │
│  │(Routage) │  │(Optimis.)  │  │ (OCR — Python, pas   │       │
│  └──────────┘  └────────────┘  │  encore orchestré)   │       │
│                                 └─────────────────────┘       │
│                                                                │
│  Seuls ports 80/443 exposés sur Internet                      │
└────────────────────────────────────────────────────────────┘
```

### Composants

| Composant | Rôle | Tech |
|-----------|------|------|
| **Next.js 15.5** | Application web + API REST | App Router, TypeScript 5.9 strict |
| **PostgreSQL 16** | Base de données principale | Prisma 7 + `@prisma/adapter-pg` |
| **Redis** | File BullMQ, cache routage, SSE Pub/Sub, rate limiting | ioredis, BullMQ 5 (optionnel — fallback in-memory) |
| **Valhalla** | Routage poids-lourds principal | Auto-hébergé, OSM France |
| **OSRM** | Repli routage PL statique | Auto-hébergé, algorithme MLD |
| **Worker VRP** | Optimisation asynchrone (BullMQ consumer) | Node.js, Worker Threads |
| **AI Engine** | OCR tickets de pesée (Donut model, GPU) | Python FastAPI, code existant mais pas orchestré en prod — voir docs/deploiement.md |

### Flux de données typique (optimisation)

```
Planificateur → POST /api/optimize
    → BullMQ enqueue (Redis)
    → Worker VRP consomme le job
    → Valhalla : matrice de distances PL
    → MV-ALNS 7 étapes → solution optimale
    → Résultat stocké Redis → SSE vers client
    → Plan sauvegardé PostgreSQL
```

## 5. Rôles utilisateurs

| Rôle | Accès | Interface |
|------|-------|-----------|
| `superadmin` | Cross-tenant : tous les tenants, télémétrie globale, impersonation | `/superadmin` (5 onglets) |
| `admin` | Tenant complet : CRUD tout, paramètres, utilisateurs, intégrations | `/admin` (13+ onglets) |
| `dispatcher` | Planification : missions, tournées, VRP, chauffeurs, véhicules par défaut | `/admin` (onglets limités) |
| `driver` | Tournée du jour : navigation, statuts, photos, commentaires | `/driver/[id]` (mobile) |

Détail complet par rôle : [docs/fonctionnalites.md](docs/fonctionnalites.md). Modèle de permissions granulaires et invariants de sécurité : [docs/authentification-securite.md](docs/authentification-securite.md).

## 6. Démarrage rapide

```bash
git clone <repo>
cd projet_clem      # nom du dossier local — le package npm s'appelle "pathelix"
npm install
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev          # http://localhost:3000
```

Guide complet (variables d'environnement, workers, tests, déploiement) : [docs/installation.md](docs/installation.md) et [docs/deploiement.md](docs/deploiement.md).

## 7. Glossaire

| Terme | Définition |
|-------|-----------|
| **Tenant** | Une entreprise cliente sur la plateforme. Données complètement isolées par `tenantId`. |
| **Mission** | Tâche terrain à accomplir (POSER, RETIRER, ECHANGER, etc.). |
| **Plan** | Tournée journalière = tableau JSON de `PlannedMission[]` affectées à des chauffeurs. |
| **Exutoire** | Site de vidage (déchetterie, centre de tri) où les bennes sont déposées. |
| **VIDER** | Mission synthétique générée par le VRP pour un vidage obligatoire à l'exutoire — jamais créée par un utilisateur, exclue des vues missions standard. |
| **PAUSE** | Mission synthétique générée par le VRP pour une pause réglementaire CE 561/2006. |
| **VRP** | Vehicle Routing Problem — problème d'optimisation de tournées de véhicules. |
| **ALNS** | Adaptive Large Neighborhood Search — méta-heuristique centrale du moteur VRP. |
| **Trade** | Secteur d'activité du tenant. Conditionne les labels UI. |
| **BSDD** | Bordereau de suivi des déchets dangereux — document Trackdéchets. HALT actif en prod, voir docs/deploiement.md. |
| **P1** | Mission prioritaire urgente. Toujours affectée, même au détriment de l'équilibre de tournée. |
| **TenantMLProfile** | Coefficients ML calculés nuitamment : ajustement des durées par chauffeur × site × type. |
| **SSE** | Server-Sent Events — flux temps réel unidirectionnel serveur → client. |
| **valhallaFactor** | Facteur de correction global du temps de trajet (défaut : 1,60). Calibré par le ML. |
| **Warm Start** | Initialisation de l'optimisation depuis le plan du même jour J-7 (semaine précédente). |
| **USE_MOCK_DATA** | Variable d'environnement. `!== 'false'` → mode mock (données en mémoire). Défaut : mock ON. |
