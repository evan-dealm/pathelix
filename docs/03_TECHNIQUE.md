# Pathélix — Architecture Technique

> Référence technique complète. Vérifiée contre le code source réel (juin 2026).

---

## Table des matières

1. [Stack technologique](#1-stack-technologique)
2. [Modèle de données (30 modèles Prisma)](#2-modèle-de-données-30-modèles-prisma)
3. [Pipeline d'authentification et sécurité](#3-pipeline-dauthentification-et-sécurité)
4. [API et conventions de route](#4-api-et-conventions-de-route)
5. [Temps réel (SSE + Redis Pub/Sub)](#5-temps-réel-sse--redis-pubsub)
6. [Workers BullMQ](#6-workers-bullmq)
7. [Moteur VRP (MV-ALNS v6)](#7-moteur-vrp-mv-alns-v6)
8. [Système ML (3 phases)](#8-système-ml-3-phases)
9. [Chaîne de routage (4 niveaux)](#9-chaîne-de-routage-4-niveaux)
10. [Résilience et modes dégradés](#10-résilience-et-modes-dégradés)
11. [Invariants critiques (ne jamais casser)](#11-invariants-critiques-ne-jamais-casser)

---

## 1. Stack technologique

| Couche | Technologie | Version |
|--------|------------|---------|
| Framework | Next.js App Router | 15.5 |
| Langage | TypeScript strict | 5.9 |
| Base de données | PostgreSQL | 16 |
| ORM | Prisma + @prisma/adapter-pg | 7 |
| State management | Zustand | 4.5 |
| Data fetching | TanStack Query | 5 |
| Virtualisation | TanStack Virtual | 3 |
| Styling | Tailwind CSS | 3.4 |
| Cartes | Leaflet + React-Leaflet | — |
| Validation | Zod | 4 |
| File de jobs | BullMQ + ioredis | 5 |
| Auth | JWT HMAC-SHA256 (Web Crypto) | — |
| Monitoring | Sentry | 10 |
| Internationalisation | next-intl | 4 |
| Routage PL | Valhalla (auto-hébergé) | — |
| Routage repli | OSRM (auto-hébergé) | — |
| Recherche floue | Fuse.js | 7 |
| Images | Sharp (via next/image) | 0.34 |
| Tests | Vitest | 3 |
| IndexedDB | idb-keyval | 6 |
| Runtime | Node.js | ≥ 18.17 |

### Design system

- Polices : Geist + Inter (Google Fonts)
- Palette premium light-mode
- Composant `OrbitalBackground` (fond animé pages publiques)
- Mode clair uniquement (dark mode non implémenté)

---

## 2. Modèle de données (30 modèles Prisma)

Schéma source : `prisma/schema.prisma`. Toutes les tables métier ont un champ `tenantId` — isolation multi-tenant garantie.

### Hiérarchie principale

```
Tenant (1)
  ├─ TenantSettings (1:1)
  ├─ TenantMLProfile (1:1)
  ├─ User (N)
  │    └─ UserPermission (N)
  ├─ Driver (N)
  │    ├─ DriverUnavailability (N)
  │    └─ FamiliarityScore (N)
  ├─ Vehicle (N)
  │    ├─ MaintenanceRecord (N)
  │    └─ FuelRecord (N)
  ├─ Client (N)
  │    └─ Site (N)
  │         └─ SiteProduct (N)
  ├─ Mission (N)
  │    ├─ MissionComment (N)
  │    ├─ DeliveryProof (N)
  │    └─ InterventionMetric (N)
  ├─ Exutoire (N)
  ├─ Plan (N)               ← missions JSON : PlannedMission[]
  ├─ PlanHistory (N)
  ├─ Template (N)
  ├─ RecurringMission (N)
  ├─ WeeklyPlan (N)
  ├─ Incident (N)
  ├─ AuditLog (N)
  ├─ ApiKey (N)
  ├─ PushSubscription (N)
  ├─ Holiday (N)
  ├─ Integration (N)
  ├─ DriverPosition (N)
  ├─ TrackdechetsAccount (N)  ← token chiffré AES-256-GCM
  └─ Bsdd (N)
```

### Énumérations (3)

```prisma
enum TenantPlan { FREE BASIC PRO ENTERPRISE }

enum UserRole { superadmin admin dispatcher driver }

enum MissionType {
  POSER RETIRER ECHANGER VIDER PAUSE
  CHARGER_IMMEDIAT DEPLACER TASSER EXPEDIER ALLER_RETOUR
}
```

`VIDER` et `PAUSE` sont synthétiques — générés par le VRP, jamais créés directement par les utilisateurs.

### Champs clés

- `Plan.missions` : `Json` — tableau de `PlannedMission[]` (structure définie dans `src/lib/schemas.ts`)
- `Integration.config` : `Json` — chiffré AES-256-GCM avant stockage
- `TrackdechetsAccount.encryptedToken` : chiffré AES-256-GCM
- `Mission.linkedExutoireId` : lien direct exutoire (pas via Client)
- `TenantSettings.valhallaFactor` : facteur ML de correction du temps de trajet (défaut : 1,60)

---

## 3. Pipeline d'authentification et sécurité

### JWT

```
POST /api/auth/login
  → vérification bcrypt du mot de passe
  → signSession({ sub, role, tenantId, driverRef?, trade?, iat, exp })
  → cookie HttpOnly SameSite=Strict Secure
  → expiry: 24h
```

Implémentation : `src/lib/session.ts` — HMAC-SHA256 via Web Crypto API (pas de dépendance NPM).

### Middleware (`src/middleware.ts`)

Exécuté sur **toutes** les requêtes avant les route handlers.

```
1. Vérifier le cookie "session" → décoder JWT
2. Refuser si expiré ou signature invalide (401)
3. STRIP les headers x-user-id, x-user-role, x-tenant-id (anti-spoofing)
4. RE-INJECTER depuis le payload JWT vérifié
5. RBAC : vérifier que le rôle peut accéder à la route
6. Rate limiting Redis (sliding window 60s)
7. Passer au route handler
```

### Lecture d'identité dans les routes

```typescript
// Seul pattern autorisé — JAMAIS req.headers.get('x-user-role') directement
import { getRequestContext } from '@/lib/data/context'

const { tenantId, role, userId } = getRequestContext(req)
```

### Isolation multi-tenant

Toutes les requêtes Prisma filtrent par `tenantId` :

```typescript
// Pattern sécurisé pour update/delete
const record = await prisma.mission.findFirst({ where: { id, tenantId } })
if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
await prisma.mission.update({ where: { id }, data: { ... } })
```

Vérification : audit complet des 119 routes — 0 fuite cross-tenant.

### Headers de sécurité

Définis exclusivement dans `next.config.mjs` (source canonique) :

- `Content-Security-Policy` : whitelist stricte
- `Strict-Transport-Security` : max-age=31536000 (désactivable via `FORCE_HTTPS=false`)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

### Rate limiting

`src/lib/rateLimit.ts` — sliding window Redis (60s). Fallback in-memory si Redis indisponible.

### Permissions granulaires

`src/lib/permissions.ts` — 11 permissions, cache 60 secondes par utilisateur.

```
ALL_PERMISSIONS = [
  'optimize', 'manage_drivers', 'manage_exutoires', 'manage_missions',
  'manage_vehicles', 'manage_users', 'view_reports', 'view_costs',
  'manage_settings', 'api_access', 'manage_integrations'
]
```

---

## 4. API et conventions de route

### Pattern standard GET

```typescript
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  // Middleware garantit tenantId non-null
  const items = await prisma.mission.findMany({ where: { tenantId } })
  return NextResponse.json(items)
}
```

### Pattern standard POST avec validation Zod

```typescript
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)
  const body = await req.json()
  const parsed = MissionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 })
  }
  const mission = await prisma.mission.create({
    data: { ...parsed.data, tenantId }
  })
  return NextResponse.json(mission)
}
```

Schémas partagés : `src/lib/schemas.ts`. Schémas spécifiques inline dans chaque route.

### Mock mode

```typescript
// Toutes les routes API — pattern obligatoire
if (process.env.USE_MOCK_DATA !== 'false') {
  return NextResponse.json(MOCK_DATA)
}
```

`USE_MOCK_DATA` est `undefined` par défaut (donc `!== 'false'` est **vrai** = mock actif).

---

## 5. Temps réel (SSE + Redis Pub/Sub)

### Architecture

```
Chauffeur terrain
  → POST /api/driver-status/update
  → statusStore.set(tenantId, driverId, status)
  → driverStatusPubSub.publish(tenantId, event)  ← Redis PUBLISH
        │
        ▼ Redis Pub/Sub channel: "driver-status:<tenantId>"
        │
        ▼ GET /api/sse/driver-status (EventSource côté client)
  → driverStatusPubSub.subscribe(tenantId, handler)
  → res.write('data: ...\n\n')
```

### Fichiers clés

| Fichier | Rôle |
|---------|------|
| `src/lib/driverStatusPubSub.ts` | Redis Pub/Sub (subscribe/publish/unsubscribe) |
| `src/lib/statusStore.ts` | Cache in-memory des derniers statuts (fallback sans Redis) |
| `src/lib/obdStore.ts` | Cache in-memory des données OBD (positions, vitesse) |
| `/api/sse/driver-status` | Endpoint SSE — flux statuts chauffeurs |
| `/api/sse/incidents` | Endpoint SSE — flux incidents |

### Limites

- Max 50 connexions SSE simultanées par tenant
- Données OBD pruned automatiquement après 500 lectures (par driver)
- Fallback in-memory si Redis indisponible : fonctionnel mais pas distribué (multi-instance impossible)

---

## 6. Workers BullMQ

### Worker VRP (`src/workers/vrpWorker.ts`)

Queue : `'vrp-jobs'`. Consomme les jobs asynchrones d'optimisation.

```
Job entrant : { tenantId, drivers, missions, options, existingPlans }
    │
    ├─ Warm start J-7 (buildWarmStartFromReference)
    ├─ Démarrage AuditRetentionWorker (CRON rétention 90j, si pas déjà actif)
    ├─ Exécution pipeline VRP 7 étapes
    ├─ Résultat → Redis (clé temporaire 1h)
    └─ Notification SSE via driverStatusPubSub
```

Commande : `npm run worker` (ou `npm run worker:vrp`).

### Worker ML (`src/workers/mlProfileWorker.ts`)

CRON nocturne à 02:30. Recalcule les coefficients ML pour tous les tenants actifs.

```
Pour chaque tenant avec ≥ 30 métriques fiables :
    → Charge InterventionMetric (isReliable=true)
    → Médiane tronquée P10–P90
    → Stocke dans TenantMLProfile
    → Portées : global / par type / par chauffeur / par site
```

Commande : `npm run worker:ml`.

### Worker Missions Récurrentes (`src/workers/recurringMissionsWorker.ts`)

Vérifie quotidiennement les `RecurringMission` et génère les missions planifiées à venir.

Commande : `npm run worker:recurring`.

### Worker Rétention Audit (`src/workers/auditRetentionWorker.ts`)

Importé et démarré depuis `vrpWorker.ts`. Purge les `AuditLog` > 90 jours.

---

## 7. Moteur VRP (MV-ALNS v6)

Source : `src/lib/vrp/` (21 fichiers). Point d'entrée : `src/lib/vrp/index.ts`.

**Invariant absolu : ce répertoire ne doit jamais être modifié sans validation complète des tests VRP.**

### Pipeline 7 étapes

```
Étape 0 — Warm Start (warmStart.ts)
  buildWarmStartFromReference() → plan J-7 comme initialisation

Étape 1 — Coefficients ML (mlCoefficients.ts)
  applyMLCoefficients() → ajuste durées selon historique terrain

Étape 2 — Filtrage HFVRP (hfvrp.ts)
  binSizeM3 ≤ maxBinSizeM3 → incompatibilités → warnings (pas erreurs)

Étape 3 — Matrice de routage (valhallaMatrix.ts / osrmMatrix.ts)
  Matrice distances/durées PL + pondérations planificateur + horaires exutoires

  ┌─ ≤ 20 chauffeurs ─────────────────────┐
  │  ALNS direct                           │
  └────────────────────────────────────────┘
  ┌─ > 20 chauffeurs ─────────────────────┐
  │  Décomposition K-means++ 4D (sector.ts)│
  │  → ALNS par secteur en Worker Threads  │
  └────────────────────────────────────────┘

Étape 5 — Post-optimisation (operators.ts)
  3-opt, chaînes d'éjection, compactage, regroupement déchets
  + Front de Pareto (optionnel) + CVaR stochastique

Étape 6 — Affectation forcée missions P1
  P1 non affectées → chauffeur le plus proche, insertion moindre surcoût

Étape 7 — Formatage (formatSolution.ts)
  VIDER/PAUSE synthétiques, sequenceOrder, precomputedTravelMin, statistiques
```

### Conformité réglementaire CE 561/2006

| Règle | Valeur |
|-------|--------|
| Temps de travail max/jour | 600 min (10h) |
| Conduite max/jour | 540 min (9h) |
| Conduite continue max | 270 min (4h30) avant pause obligatoire |
| Pause obligatoire | 45 min |
| Repos journalier minimum | 660 min (11h) |

### Performances

| Instance | Chauffeurs | Missions | Temps typique |
|----------|-----------|---------|---------------|
| Petite | 2 | 10 | < 5s |
| Moyenne | 5–10 | 50–100 | 5–15s |
| Grande | 20–50 | 200–500 | 15–30s |
| Très grande | 100+ | 1 000+ | 30–120s |
| Maximum | 1 000 | 50 000 | Variable (parallélisé) |

Qualité : typiquement dans les **1–3 %** de l'optimum théorique.

Pour le détail complet de l'algorithme (opérateurs ALNS, bandit adaptatif, CVaR, familiarité, glossaire) : voir `docs/ALGORITHM.md` (conservé).

---

## 8. Système ML (3 phases)

### Phase 1 — Collecte terrain (`src/lib/metricCollector.ts`)

Déclenchée quand un chauffeur termine une mission.

Enregistre 3 durées réelles : trajet (`arrivée − départ`), manœuvre (`début_travail − arrivée`), intervention (`fin − début_travail`).

**3 boucliers qualité** rejettent les données non fiables :
1. Clic trop rapide (< 10s entre deux étapes) → REJETÉ
2. Durée aberrante (> 4× la durée attendue) → REJETÉ
3. GPS incohérent (0 min trajet mais delta GPS > 10 km) → REJETÉ

Données valides stockées dans `InterventionMetric` (`isReliable=true`, `confidenceScore` [0,1]).

### Phase 2 — Calcul des coefficients (`src/workers/mlProfileWorker.ts`)

CRON nocturne à 02:30. Médiane tronquée P10–P90 par portée :

| Portée | Observations min |
|--------|-----------------|
| Global tenant | ≥ 30 |
| Par type de mission | ≥ 15 |
| Par chauffeur | ≥ 20 |
| Par site | ≥ 10 |

Résultat stocké dans `TenantMLProfile`.

### Phase 3 — Application (`src/lib/vrp/index.ts → applyMLCoefficients`)

Hiérarchie des coefficients (du plus précis au plus général) :
1. chauffeur + type de mission
2. site + type de mission
3. chauffeur (tous types)
4. type de mission (tous)
5. global tenant
6. aucun → 1,0 (pas de correction)

Correction appliquée uniquement si delta > 5 %. Borné entre [0,3 ; 3,0].

### Maturité

5 chauffeurs × 20 missions/jour → ~100 métriques/semaine → maturité complète (~5 portées actives) en ~5 semaines.

---

## 9. Chaîne de routage (4 niveaux)

Source : `src/lib/vrp/realDistance.ts` — `realDistanceKm()` / `realDurationMin()`.

| Priorité | Source | Activation | Qualité |
|----------|--------|------------|---------|
| 4 (meilleure) | API externe (Trimble/HERE/générique) | `ROUTING_API_TYPE` + `ROUTING_API_KEY` | Données PL certifiées, trafic temps réel |
| 3 | Valhalla auto-hébergé | `VALHALLA_URL` | Profil véhicule dynamique |
| 2 | OSRM auto-hébergé | `OSRM_URL` | Profil PL statique |
| 1 (repli) | Haversine × tortuosité | Toujours disponible | Estimation géométrique |

Facteurs haversine : × 1,50 (< 5 km urbain), × 1,35 (< 20 km péri-urbain), × 1,20 (≥ 20 km).

Matrice mise en cache Redis 24h, indexée par hash coordonnées + profil véhicule.

---

## 10. Résilience et modes dégradés

| Panne | Impact | Comportement |
|-------|--------|-------------|
| Redis indisponible | Cache perdu, BullMQ hors service, rate limit non partagé | VRP synchrone dans Next.js, SSE polling 2s, fallback in-memory rate limit |
| Valhalla/OSRM indisponible | Distances PL dégradées | Repli haversine automatique — optimisation continue |
| Worker VRP absent | Pas d'optimisation asynchrone | VRP synchrone dans Next.js (plus lent, même résultat) — retourne mode: "sync" |
| PostgreSQL indisponible | Toutes les API → 500 | Health check → `status: "outage"`, reprise auto au redémarrage |
| GPU AI Engine absent | OCR/Copilot indisponibles | Toutes les autres fonctionnalités opérationnelles |
| API externe routage indisponible | Dégradation qualité VRP | Fallback Valhalla → OSRM → haversine automatique |

### Circuit breakers

`src/lib/circuitBreaker.ts` — protection contre les pannes d'API externes. États : CLOSED → OPEN (après N échecs) → HALF_OPEN (test de récupération).

---

## 11. Invariants critiques (ne jamais casser)

Ces invariants sont définis dans `CLAUDE.md` et protégés par les tests.

1. **Isolation multi-tenant** : toute requête Prisma filtre par `tenantId`
2. **Chaîne d'auth** : middleware strip + re-inject JWT. `getRequestContext(req)` exclusif dans les routes
3. **CSP canonique** : `next.config.mjs` seul — jamais dans `middleware.ts`
4. **Mock mode flag** : `process.env.USE_MOCK_DATA !== 'false'` (défaut = mock ON)
5. **Intégrité VRP** : `src/lib/vrp/` jamais modifié sans validation complète
6. **Zod aux boundaries** : toutes les routes POST/PUT valident avec un schéma Zod avant toute écriture DB
