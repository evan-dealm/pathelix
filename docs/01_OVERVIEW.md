# Pathélix — Vue d'ensemble

> Documentation produit complète. Vérifiée contre le code source réel (juin 2026).

---

## Table des matières

1. [Qu'est-ce que Pathélix ?](#1-quest-ce-que-pathélix-)
2. [Problème résolu](#2-problème-résolu)
3. [Six secteurs d'activité](#3-six-secteurs-dactivité)
4. [Proposition de valeur](#4-proposition-de-valeur)
5. [Architecture globale](#5-architecture-globale)
6. [Cycle de vie des données](#6-cycle-de-vie-des-données)
7. [Rôles utilisateurs](#7-rôles-utilisateurs)
8. [Glossaire](#8-glossaire)

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

---

## 2. Problème résolu

Les entreprises de terrain gèrent leurs tournées manuellement ou avec des outils génériques inadaptés. Les conséquences : kilomètres superflus, retards clients, planificateurs surchargés, données terrain disparates.

Pathélix automatise la décision de tournée avec un algorithme qui tient compte simultanément de :

- La **géographie et les distances réelles** (profil poids-lourds via Valhalla/Trimble/HERE)
- Les **fenêtres horaires clients** (VRPTW)
- La **capacité des véhicules** (bennes en m³, flotte hétérogène)
- Les **priorités de mission** (P1 toujours affectées, même au détriment de l'équilibre)
- L'**historique terrain** (coefficients ML par chauffeur × site × type de mission)
- La **réglementation du travail** (pauses CE 561/2006, max 10h/jour)

---

## 3. Six secteurs d'activité

Pathélix s'adapte au vocabulaire de chaque secteur via le champ `trade` du tenant. Six valeurs sont reconnues :

| Trade | Secteur | Terminologie adaptée |
|-------|---------|---------------------|
| `COLLECTE_RECYCLAGE` | Collecte & Recyclage | Bennes, exutoires, BSDD, vidages |
| `LIVRAISON_DISTRIBUTION` | Livraison & Distribution | Colis, tournées, livraisons, retours |
| `BTP_LOCATION` | BTP & Location | Engins, dépôts, chantiers, matériel |
| `DEMENAGEMENT` | Déménagement | Meubles, camions, équipes, encombrants |
| `MAINTENANCE_SAV` | Maintenance & SAV | Interventions, pièces, techniciens |
| `COURSIER_EXPRESS` | Coursier & Express | Colis urgents, relais, livraisons express |

Les labels UI (missions, véhicules, sites) changent dynamiquement selon le trade du tenant.

---

## 4. Proposition de valeur

| Bénéfice | Mesure |
|----------|--------|
| Réduction kilométrique | 15–25 % sur flottes comparables |
| Temps de planification | De 2h manuelles à ~30s automatisées |
| Réduction CO2 | Proportionnelle à la réduction km (rapport dédié) |
| Respect des délais | Pénalités de fenêtres horaires dans la fonction coût |
| Apprentissage terrain | Prédictions ML matures en ~5 semaines d'utilisation |
| Conformité | CE 561/2006 automatique, Trackdéchets BSDD intégré |

---

## 5. Architecture globale

Pathélix fonctionne sur un **serveur cloud dédié unique**. Tous les services communiquent via un réseau bridge Docker interne.

```
Internet (HTTPS)
      │
      ▼
┌────────────────────────────────────────────────────────────┐
│  SERVEUR CLOUD DÉDIÉ                                       │
│                                                            │
│  ┌───────────┐  ┌────────────┐  ┌───────┐                 │
│  │  Next.js  │  │ PostgreSQL │  │ Redis │                 │
│  │  (App)    │  │   (Data)   │  │(Queue)│                 │
│  └─────┬─────┘  └─────┬──────┘  └───┬───┘                 │
│        │               │             │                     │
│        └───────────────┴─────────────┘                     │
│                   Bridge Docker (< 1ms)                    │
│        ┌───────────────┬─────────────┐                     │
│        ▼               ▼             ▼                     │
│  ┌──────────┐  ┌────────────┐  ┌─────────────────────┐   │
│  │ Valhalla │  │ Worker VRP │  │ AI Engine [ROADMAP] │   │
│  │(Routage) │  │(Optimis.)  │  │ (OCR, GPU — non     │   │
│  └──────────┘  └────────────┘  │  intégré en prod)   │   │
│                                 └─────────────────────┘   │
│                                                            │
│  Seuls ports 80/443 exposés sur Internet                   │
└────────────────────────────────────────────────────────────┘
```

### Composants

| Composant | Rôle | Tech |
|-----------|------|------|
| **Next.js 15.5** | Application web + API REST | App Router, TypeScript 5.9 strict |
| **PostgreSQL 16** | Base de données principale | Prisma 7 + @prisma/adapter-pg |
| **Redis** | File BullMQ, cache routage, SSE Pub/Sub, rate limiting | ioredis, BullMQ 5 |
| **Valhalla** | Routage poids-lourds principal (profil dynamique) | Auto-hébergé, OSM France |
| **OSRM** | Repli routage PL statique | Algorithme MLD, Rhône-Alpes |
| **Worker VRP** | Optimisation asynchrone (BullMQ consumer) | Node.js, Worker Threads |
| **AI Engine** _(ROADMAP)_ | OCR tickets de pesée (Donut model, GPU) — **non intégré en production** | Python FastAPI — voir `docs/AI_ROADMAP.md` |

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

---

## 6. Cycle de vie des données

### Mission

```
Création (admin/dispatcher/webhook Nessy)
    │
    ├─ Validation Zod (type, GPS, fenêtre horaire)
    ├─ Enregistrement Mission (PostgreSQL, tenantId)
    │
    ├─ Optimisation VRP (PlannedMission dans Plan.missions JSON)
    │    ├─ sequenceOrder, precomputedTravelMin, depotStep
    │    └─ VIDER/PAUSE synthétiques insérés
    │
    ├─ Exécution terrain (interface chauffeur)
    │    ├─ Statuts : pending → started → arrived → done
    │    ├─ Photo de preuve (DeliveryProof)
    │    ├─ Commentaire mission (MissionComment)
    │    └─ Position GPS (DriverPosition)
    │
    ├─ Collecte ML (InterventionMetric)
    │    └─ Durées réelles trajet/manœuvre/intervention
    │
    └─ Archivage (isArchived=true) ou suppression
```

### Tenant

```
Onboarding (/onboarding → POST /api/onboarding)
    │
    ├─ Création Tenant (plan, trade, paramètres)
    ├─ Création Admin initial
    ├─ TenantSettings (valhallaFactor, pondérations VRP...)
    │
    ├─ Utilisation quotidienne
    │    ├─ TenantMLProfile (calculé nuit à 02:30)
    │    └─ Audit logs (AuditLog, rétention 90 jours)
    │
    └─ Facturation selon TenantPlan (FREE / BASIC / PRO / ENTERPRISE)
```

---

## 7. Rôles utilisateurs

| Rôle | Accès | Interface |
|------|-------|-----------|
| `superadmin` | Cross-tenant : tous les tenants, télémétrie globale, impersonation | `/superadmin` (5 onglets) |
| `admin` | Tenant complet : CRUD tout, paramètres, utilisateurs, intégrations | `/admin` (13+ onglets) |
| `dispatcher` | Planification : missions, tournées, VRP, chauffeurs, véhicules | `/admin` (onglets limités) |
| `driver` | Tournée du jour : navigation, statuts, photos, commentaires | `/driver/[id]` (mobile) |

### Permissions granulaires (11)

`optimize` · `manage_drivers` · `manage_exutoires` · `manage_missions` · `manage_vehicles` · `manage_users` · `view_reports` · `view_costs` · `manage_settings` · `api_access` · `manage_integrations`

Permissions stockées dans `UserPermission`, avec cache 60 secondes. Défauts par rôle définis dans `src/lib/permissions.ts`.

### Impersonation superadmin

Un superadmin peut prendre l'identité d'un admin tenant. La session d'impersonation a `sub=sa:<userId_original>` et `role=admin` pour le tenant cible. Tout accès est journalisé dans l'audit.

---

## 8. Glossaire

| Terme | Définition |
|-------|-----------|
| **Tenant** | Une entreprise cliente sur la plateforme. Données complètement isolées par `tenantId`. |
| **Mission** | Tâche terrain à accomplir (POSER, RETIRER, ECHANGER, etc.). |
| **Plan** | Tournée journalière = tableau JSON de `PlannedMission[]` affectées à des chauffeurs. |
| **Exutoire** | Site de vidage (déchetterie, centre de tri) où les bennes sont déposées. |
| **VIDER** | Mission synthétique générée par le VRP pour un vidage obligatoire à l'exutoire. |
| **PAUSE** | Mission synthétique générée par le VRP pour une pause réglementaire CE 561/2006. |
| **VRP** | Vehicle Routing Problem — problème d'optimisation de tournées de véhicules. |
| **ALNS** | Adaptive Large Neighborhood Search — méta-heuristique centrale du moteur VRP. |
| **Trade** | Secteur d'activité du tenant (6 valeurs). Conditionne les labels UI. |
| **BSDD** | Bordereau de suivi des déchets dangereux — document Trackdéchets. |
| **P1** | Mission prioritaire urgente. Toujours affectée, même au détriment de l'équilibre de tournée. |
| **TenantMLProfile** | Coefficients ML calculés nuitamment : ajustement des durées par chauffeur × site × type. |
| **SSE** | Server-Sent Events — flux temps réel unidirectionnel serveur → client. |
| **valhallaFactor** | Facteur de correction global du temps de trajet (défaut : 1,60). Calibré par le ML. |
| **Warm Start** | Initialisation de l'optimisation depuis le plan du même jour J-7 (semaine précédente). |
| **CVaR** | Conditional Value at Risk — robustesse de la solution face aux scénarios stochastiques. |
| **USE_MOCK_DATA** | Variable d'environnement. `!== 'false'` → mode mock (données en mémoire). Défaut : mock ON. |
