# Pathélix — Architecture technique

> Référence technique complète. Vérifiée contre le code source réel (août 2026).
> Vue d'ensemble produit : [README.md](README.md). Fonctionnalités : [FEATURES.md](FEATURES.md). Routes API : [API.md](API.md). Déploiement/runbook : [OPERATIONS.md](OPERATIONS.md).

---

## 1. Stack technologique

| Couche | Technologie | Version |
|--------|------------|---------|
| Framework | Next.js App Router | 15.5 (bump majeur vers 16 évalué et volontairement différé — voir §11 et OPERATIONS.md) |
| Langage | TypeScript strict | 5.9 |
| Base de données | PostgreSQL | 16 |
| ORM | Prisma + `@prisma/adapter-pg` | 7 |
| State management | Zustand | 4.5 |
| Data fetching | TanStack Query | 5 |
| Styling | Tailwind CSS | 3.4 |
| Cartes | Leaflet + React-Leaflet | — |
| Validation | Zod | 4 |
| File de jobs | BullMQ + ioredis | 5 |
| Auth | JWT HMAC-SHA256 (Web Crypto) | — |
| Monitoring | Sentry + OpenTelemetry | 10 / 0.221 |
| Internationalisation | next-intl (installé, non câblé) | 4 |
| Routage PL | Valhalla (auto-hébergé), OSRM (repli) | — |
| Images | Sharp (via `next/image`) | 0.35.3 |
| Tests | Vitest 3 (unitaire), Playwright 1.58 (E2E) | — |

### Design system

- Polices : Geist + Inter
- Palette premium light-mode uniquement (dark mode non implémenté)
- Composant `OrbitalBackground` (fond animé pages publiques)

---

## 2. Modèle de données

Schéma source : `prisma/schema.prisma` — 30 modèles, 3 énumérations. Toutes les tables métier ont un champ `tenantId` : isolation multi-tenant garantie par convention de code (**pas** par Row-Level Security PostgreSQL — chaque requête Prisma doit filtrer explicitement).

### Hiérarchie principale

```
Tenant (1)
  ├─ TenantSettings (1:1)
  ├─ TenantMLProfile (1:1)
  ├─ User (N) ── UserPermission (N)
  ├─ Driver (N) ── DriverUnavailability (N), FamiliarityScore (N)
  ├─ Vehicle (N) ── MaintenanceRecord (N), FuelRecord (N)
  ├─ Client (N) ── Site (N) ── SiteProduct (N)
  ├─ Mission (N) ── MissionComment (N), DeliveryProof (N), InterventionMetric (N)
  ├─ Exutoire (N)
  ├─ Plan (N)                 ← missions JSON : PlannedMission[]
  ├─ MissionTemplate (N)      ← missions récurrentes, backed en DB (pas client-side)
  ├─ Incident (N)
  ├─ AuditLog (N)
  ├─ ApiKey (N) · PushSubscription (N) · Holiday (N) · Integration (N)
  ├─ DriverPosition (N)
  ├─ AiJob (N)                ← jobs OCR (voir §9)
  ├─ TrackdechetsAccount (N)  ← token chiffré AES-256-GCM
  └─ Bsd (N)
```

### Énumérations

```prisma
enum TenantPlan { FREE BASIC PRO ENTERPRISE }
enum UserRole   { SUPERADMIN ADMIN DISPATCHER DRIVER }
enum MissionType {
  POSER RETIRER ECHANGER VIDER PAUSE
  CHARGER_IMMEDIAT DEPLACER TASSER EXPEDIER ALLER_RETOUR
}
```

`VIDER` et `PAUSE` sont synthétiques — générées par le VRP, jamais créées directement par un utilisateur ni acceptées par les schémas Zod de création manuelle (`UserCreateSchema` etc.). Les vues UI standard (table Missions) les excluent via `SYNTHETIC_TYPES`.

### Champs clés

- `Plan.missions` : `Json` — tableau de `PlannedMission[]` (structure dans `src/lib/schemas.ts`)
- `Integration.config` : `Json` — chiffré AES-256-GCM avant stockage
- `TrackdechetsAccount.encryptedToken` : chiffré AES-256-GCM
- `Mission.linkedExutoireId` : lien direct exutoire (pas via `Client`)
- `Mission.generatedFromTemplateId` : lien stable vers le `MissionTemplate` d'origine pour les missions récurrentes (dédup par ce champ, pas par heuristique de correspondance)
- `TenantSettings.valhallaFactor` : facteur ML de correction du temps de trajet (défaut 1,60)

---

## 3. Authentification et sécurité — invariants critiques

Ces invariants sont protégés par les tests et **ne doivent jamais être cassés** :

1. **Isolation multi-tenant** : toute requête Prisma filtre par `tenantId`
2. **Chaîne d'auth** : le middleware strip les headers `x-user-id`/`x-user-role`/`x-tenant-id` entrants puis les ré-injecte depuis le JWT vérifié. `getRequestContext(req)` (`src/lib/data/context.ts`) est le seul point de lecture autorisé dans les routes — jamais `req.headers.get('x-user-role')` directement
3. **CSP canonique** : définie exclusivement dans `next.config.mjs`, jamais dans `middleware.ts`
4. **Mock mode** : `process.env.USE_MOCK_DATA !== 'false'` (défaut = mock ON, pas `=== 'true'`)
5. **Intégrité VRP** : `src/lib/vrp/` jamais modifié sans validation complète de sa suite de tests
6. **Zod aux frontières** : toutes les routes POST/PUT valident avec un schéma Zod avant toute écriture DB

### JWT

```
POST /api/auth/login
  → vérification bcrypt du mot de passe
  → signSession({ sub, role, tenantId, driverRef?, trade?, iat, exp })
  → cookie HttpOnly SameSite=Strict Secure, expiry 24h
```

`src/lib/session.ts` — HMAC-SHA256 via Web Crypto API, pas de dépendance NPM.

### Middleware (`src/middleware.ts`)

Exécuté sur toutes les requêtes : décode/vérifie le JWT (401 si invalide/expiré) → strip + ré-injecte les headers d'identité → RBAC par rôle → rate limiting Redis → passe au route handler.

### Isolation multi-tenant — pattern

```typescript
const record = await prisma.mission.findFirst({ where: { id, tenantId } })
if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
await prisma.mission.update({ where: { id }, data: { ... } })
```

### Permissions granulaires

`src/lib/permissions.ts` — 11 permissions (`optimize`, `manage_drivers`, `manage_exutoires`, `manage_missions`, `manage_vehicles`, `manage_users`, `view_reports`, `view_costs`, `manage_settings`, `api_access`, `manage_integrations`), cache 60s par utilisateur.

```typescript
DEFAULT_PERMISSIONS = {
  admin:      [...ALL_PERMISSIONS],
  superadmin: [...ALL_PERMISSIONS],
  dispatcher: ['optimize', 'manage_missions', 'manage_drivers', 'view_reports', 'manage_vehicles'],
  driver:     [],
}
```

`hasPermission()` court-circuite `true` pour `admin`/`superadmin` sans jamais consulter `UserPermission`, et retombe sur `DEFAULT_PERMISSIONS[role] ?? []` pour tout le reste — **fail-closed par construction** : un rôle sans entrée `UserPermission` personnalisée n'a jamais accès à plus que le défaut de son rôle.

`hasPermission()` est câblée comme filtre effectif sur les 11 familles de routes de mutation (drivers, vehicles, missions, exutoires, users, settings, integrations, reports, api-keys, templates), permettant à un admin d'accorder ou retirer une permission à un `dispatcher` spécifique via `PUT /api/permissions`, exposé dans l'UI (panneau Permissions de l'édition utilisateur).

### Rate limiting

`src/lib/rateLimit.ts` — sliding window Redis (60s), fallback in-memory si Redis indisponible. Login : 5 tentatives / 60s par IP.

### Headers de sécurité

Définis exclusivement dans `next.config.mjs` : CSP (whitelist stricte), HSTS (`FORCE_HTTPS=false` pour désactiver en dev), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.

### Chiffrement

- Secrets d'intégration (`Integration.config`) et token Trackdéchets : AES-256-GCM (`src/lib/configCrypto.ts`)
- Webhooks (Nessy, OBD, Geotab, Samsara) : secret/clé **par tenant**, jamais une variable d'environnement globale — le tenant est résolu en trouvant quelle intégration activée vérifie la signature/clé fournie, jamais depuis un header client-asserté. Détail complet : API.md

### Audit trail

`AuditLog` (rétention 90 jours, CRON de purge). Écrit sur les mutations sensibles : création/modification/suppression de drivers, missions, véhicules, **utilisateurs (y compris changement de rôle)**, permissions, intégrations, et sur la purge d'audit elle-même (via `logSuperadminAction`, tracée même si l'action est de purger l'audit). Les mutations non sensibles (exutoires, settings, templates, sites, clients…) ne sont pas auditées individuellement — périmètre volontairement limité aux ressources à fort impact sécurité.

### Impersonation superadmin

Un superadmin peut prendre l'identité d'un admin tenant. Session `sub=sa:<userId_original>`, `role=admin` pour le tenant cible. Tout accès est journalisé.

---

## 4. API et conventions de route

### Pattern GET

```typescript
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  const items = await prisma.mission.findMany({ where: { tenantId } })
  return NextResponse.json(items)
}
```

### Pattern POST/PUT (validation Zod obligatoire)

```typescript
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId, role } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_missions'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }
  const body = await req.json()
  const parsed = MissionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 })
  const mission = await prisma.mission.create({ data: { ...parsed.data, tenantId } })
  return NextResponse.json(mission)
}
```

Schémas partagés : `src/lib/schemas.ts`. Schémas spécifiques inline dans chaque route.

### Mock mode

```typescript
if (process.env.USE_MOCK_DATA !== 'false') return NextResponse.json(MOCK_DATA)
```

---

## 5. Temps réel (SSE + Redis Pub/Sub)

```
Chauffeur terrain
  → POST /api/driver-status/update
  → statusStore.set(tenantId, driverId, status)
  → driverStatusPubSub.publish(tenantId, event)  ← Redis PUBLISH
        ▼ canal "driver-status:<tenantId>"
        ▼ GET /api/sse/driver-status (EventSource client)
  → res.write('data: ...\n\n')
```

- Fallback in-memory/polling si Redis indisponible (fonctionnel, pas distribué multi-instance)
- Limite : 200 connexions SSE simultanées par tenant par défaut (`SSE_MAX_CONNECTIONS_PER_TENANT`)
- Données OBD prunées automatiquement après 500 lectures par driver

---

## 6. Workers BullMQ

| Worker | Fichier | Rôle | Commande |
|--------|---------|------|----------|
| VRP | `src/workers/vrpWorker.ts` | Consomme la queue `vrp-jobs`, exécute le pipeline 7 étapes, démarre aussi le worker de rétention audit | `npm run worker` |
| ML | `src/workers/mlProfileWorker.ts` | CRON nocturne 02:30, recalcule les coefficients ML par tenant | `npm run worker:ml` |
| Missions récurrentes | `src/workers/recurringMissionsWorker.ts` | Génère quotidiennement les missions à venir depuis les `MissionTemplate` actifs | `npm run worker:recurring` |
| Rétention audit | `src/workers/auditRetentionWorker.ts` | Importé/démarré par `vrpWorker.ts`, purge `AuditLog` > 90 jours | (auto) |

---

## 7. Moteur VRP (MV-ALNS v6)

Source : `src/lib/vrp/` (~21 fichiers). Point d'entrée : `src/lib/vrp/index.ts`.

**Invariant absolu : ce répertoire ne doit jamais être modifié sans validation complète des tests VRP.**

### Pipeline 7 étapes

```
0 — Warm Start          : plan J-7 comme initialisation
1 — Coefficients ML     : ajuste durées selon historique terrain
2 — Filtrage HFVRP      : binSizeM3 ≤ maxBinSizeM3 → warnings (pas erreurs — voir limite ci-dessous)
3 — Matrice de routage  : distances/durées PL + pondérations + horaires exutoires
    ≤ 20 chauffeurs → ALNS direct
    > 20 chauffeurs → décomposition K-means++ 4D par secteur, Worker Threads
5 — Post-optimisation   : 3-opt, chaînes d'éjection, compactage + Pareto/CVaR optionnels
6 — Affectation forcée  : P1 non affectées → chauffeur le plus proche, insertion moindre surcoût
7 — Formatage           : VIDER/PAUSE synthétiques, sequenceOrder, precomputedTravelMin
```

### Limite connue — pas de contrainte dure hazmat/gabarit

`isHfvrpCompatible()` (`src/lib/vrp/hfvrp.ts`) ne compare que `mission.binSizeM3` contre `driver.maxBinSizeM3`. Aucune contrainte dure sur les matières dangereuses ou le gabarit véhicule (hauteur/largeur/longueur — champs existants sur `Driver` mais non exploités comme contrainte). Pas un bug actif (aucun champ hazmat requis exposé aujourd'hui) mais à corriger avant tout usage intensif BTP/hazmat réel où un mauvais appariement aurait un impact sécurité, pas seulement une inefficacité de tournée.

### Limite connue — bonus trafic urbain codé en dur

5 villes de la région Rhône-Alpes (Grenoble, Lyon, Chambéry, Annecy, Genève-frontière — `src/lib/algorithm.ts`, `DEFAULT_URBAN_CENTERS`) sont codées en dur pour le bonus de trafic directionnel. Override possible via `URBAN_CENTERS_JSON`, mais une seule liste globale, pas de configuration par tenant. À retraiter avant d'onboarder un tenant hors région.

### Backlog connu — pas de contrainte PTAC (poids cumulé)

Le VRP ne vérifie pas la somme des poids livrés sur une tournée contre le PTAC du véhicule (seul le volume `binSizeM3`/`maxBinSizeM3` est contraint). Pertinent pour un usage type grumier/transport de matériaux à densité variable. Proxy acceptable si la flotte n'est pas mixte : utiliser `binSizeM3` comme volume proxy. Déclencheur d'implémentation : un client demandant explicitement la conformité PTAC avec des chargements de densité différente ou une flotte mixte.

### Conformité réglementaire CE 561/2006

| Règle | Valeur |
|-------|--------|
| Temps de travail max/jour | 600 min (10h) |
| Conduite max/jour | 540 min (9h) |
| Conduite continue max | 270 min (4h30) avant pause obligatoire |
| Pause obligatoire | 45 min |
| Repos journalier minimum | 660 min (11h) |

### Performances (indicatif — dépend du CPU serveur réel)

| Instance | Chauffeurs | Missions | Temps typique |
|----------|-----------|---------|---------------|
| Petite | 2 | 10 | < 5s |
| Moyenne | 5–10 | 50–100 | 5–15s |
| Grande | 20–50 | 200–500 | 15–30s |
| Très grande | 100+ | 1 000+ | 30–120s |

Qualité typique : dans les 1–3 % de l'optimum théorique.

---

## 8. Système ML (3 phases)

### Phase 1 — Collecte terrain (`src/lib/metricCollector.ts`)

Déclenchée à la complétion d'une mission. Enregistre 3 durées réelles (trajet, manœuvre, intervention). **3 boucliers qualité** rejettent les données non fiables : clic trop rapide (< 10s), durée aberrante (> 4× attendue), GPS incohérent (0 min trajet mais delta GPS > 10 km). Stockage dans `InterventionMetric` (`isReliable`, `confidenceScore`).

### Phase 2 — Calcul des coefficients (`src/workers/mlProfileWorker.ts`)

CRON nocturne 02:30. Médiane tronquée P10–P90 par portée (global tenant ≥30 obs, par type ≥15, par chauffeur ≥20, par site ≥10). Résultat dans `TenantMLProfile`.

### Phase 3 — Application

Hiérarchie du plus précis au plus général : chauffeur+type → site+type → chauffeur → type → global tenant → 1,0 (pas de correction). Correction appliquée uniquement si delta > 5 %, bornée [0,3 ; 3,0].

### Maturité

5 chauffeurs × 20 missions/jour → maturité complète en ~5 semaines.

---

## 9. OCR / IA — statut réel

| Module | Statut |
|--------|--------|
| Prédiction ML de durée (§8) | ✅ Déployé, en production |
| Saisie de mission en langage naturel | 🔶 Fonctionnel si Ollama joignable (`OLLAMA_URL`), pas de repli sinon |
| OCR ticket de pesée | 🔶 **API Next.js complète et modèle `AiJob` en base** (`POST /api/ai/ocr`, `POST /api/ai/callback`, `GET /api/ai/jobs[/[id]]`) — pousse le job vers une queue Redis (`ai:ocr:queue`). Le consommateur Python (`ai-engine/`, FastAPI + worker Donut GPU) existe en code mais n'est **pas orchestré** en production (pas de `docker-compose.ai.yml`) — la queue n'est actuellement consommée par personne en déploiement réel |
| Copilot planificateur (langage naturel → requêtes) | ❌ Non démarré, aucun code |

Architecture cible OCR (côté Next.js déjà implémenté) :

```
POST /api/ai/ocr → validation (taille, magic bytes, IDOR tenant) → LPUSH ai:ocr:queue (Redis)
  → 202 { jobId }
ai-engine/ (Python, à orchestrer) consomme la queue → Donut GPU → POST /api/ai/callback (HMAC)
  → AiJob mis à jour, notifié via SSE
```

Pour finaliser : ajouter `ai-engine` à un `docker-compose.ai.yml`, configurer le runtime NVIDIA sur le serveur cible, collecter des photos de tickets réelles pour le fine-tuning Donut.

---

## 10. Résilience et modes dégradés

| Panne | Impact | Comportement |
|-------|--------|-------------|
| Redis indisponible | Cache perdu, BullMQ hors service, rate limit non partagé | VRP synchrone dans Next.js, SSE polling, fallback in-memory rate limit |
| Valhalla/OSRM indisponible | Distances PL dégradées | Repli haversine automatique |
| Worker VRP absent | Pas d'optimisation asynchrone | VRP synchrone dans Next.js, retourne `mode: "sync"` |
| PostgreSQL indisponible | Toutes les API → 500 | Health check → `status: "outage"` |
| API externe routage indisponible | Dégradation qualité VRP | Fallback Valhalla → OSRM → haversine |

`src/lib/circuitBreaker.ts` protège les appels aux API externes de routage (CLOSED → OPEN après N échecs → HALF_OPEN).

---

## 11. Dépendances et sécurité — état de l'audit

- `npm audit` : **0 vulnérabilité high/critical** (dernière vérification août 2026). 3 findings résiduels (1 low `esbuild`, 2 moderate `exceljs`/`uuid`) individuellement vérifiés non exploitables dans ce codebase — voir OPERATIONS.md pour le détail par CVE.
- `postcss` et `sharp` forcés à leurs versions patchées via `overrides` dans `package.json` : Next.js 15.5 embarque en interne des copies non-dédupliquées de ces deux paquets figées à des versions vulnérables ; l'override npm déduplique toutes les copies (y compris celles pinnées par Next) sans nécessiter de bump de Next lui-même.
- **Next.js 16 (majeur)** : évalué, non appliqué. Build/tests/typecheck passent sous Next 16, mais le fichier `middleware.ts` (garde d'accès la plus sensible du projet — invariant #2 ci-dessus) y est marqué déprécié au profit d'une nouvelle convention `proxy`. Migration jugée trop risquée à faire sans revue humaine dédiée tant que le pilote n'est pas en production à pleine échelle — traitée comme chantier séparé post-pilote, pas glissée dans une session de routine. Branche de travail conservée (voir OPERATIONS.md).

---

## 12. Tests

- **199 fichiers**, **~3 535 tests unitaires** (Vitest), 100% verts au dernier passage
- **31 specs E2E** (Playwright) — voir OPERATIONS.md pour le détail d'exécution et le taux de réussite réel du dernier run complet
- Règle impérative : ne jamais skipper/désactiver un test pour avancer, ne jamais baisser un seuil de couverture, `src/lib/vrp/` jamais modifié sans validation complète de sa suite
