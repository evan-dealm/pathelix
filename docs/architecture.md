# Pathélix — Architecture

> Vue d'ensemble technique, arborescence, flux de données. Vérifié contre le code réel le
> 2026-09-21. Détails sécurité : [authentification-securite.md](authentification-securite.md).
> Schéma de données : [base-de-donnees.md](base-de-donnees.md). Routes : [api.md](api.md).

## 1. Stack technologique

| Couche | Technologie | Version |
|--------|------------|---------|
| Framework | Next.js App Router | 15.5.25 |
| Langage | TypeScript strict | 5.9 |
| Base de données | PostgreSQL | 16 |
| ORM | Prisma + `@prisma/adapter-pg` | 7 |
| State management | Zustand | 4.5 |
| Data fetching | TanStack Query | 5 |
| Styling | Tailwind CSS | 3.4 |
| Cartes | MapLibre GL JS (intégration directe, sans wrapper React) | 6 |
| Validation | Zod | 4 |
| File de jobs | BullMQ + ioredis | 5 |
| Auth | JWT HMAC-SHA256 (Web Crypto) | — |
| Monitoring | Sentry + OpenTelemetry | 10 / 0.221 |
| Internationalisation | next-intl (installé, non câblé — voir [fonctionnalites.md](fonctionnalites.md)) | 4 |
| Routage PL | Valhalla (auto-hébergé), OSRM (repli) | — |
| Images | Sharp (utilisé implicitement par `next/image`, jamais importé directement dans le code applicatif) | 0.35.4+ |
| Tests | Vitest 3 (unitaire), Playwright 1.58 (E2E) | — |

## 2. Déploiement mono-serveur

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

Tous les services communiquent via un bridge Docker interne — **pas de cluster distribué**.
Implication directe : les caches in-memory (rate limiting fallback, suspension tenant) sont
**par process** — une bascule multi-instance nécessiterait un mécanisme d'invalidation partagé
(Redis pub/sub) qui n'existe pas aujourd'hui. Accepté comme hypothèse de conception pour le
pilote actuel.

## 3. Arborescence commentée (dossiers principaux sous `src/`)

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # ~120 routes API REST (voir api.md)
│   ├── admin/page.tsx      # Interface admin/dispatcher, 13+ onglets
│   ├── driver/[id]/page.tsx  # Interface mobile chauffeur
│   ├── superadmin/         # Console cross-tenant
│   └── (pages publiques)   # /, /login, /onboarding, /help, /status, /track/[token]
├── components/             # Composants React (admin/, driver/, ui/, superadmin/…)
├── lib/
│   ├── data/context.ts     # getRequestContext() — seul point de lecture identité
│   ├── vrp/                # Moteur VRP MV-ALNS v6 (~21 fichiers) — invariant critique
│   ├── trackdechets/       # Client GraphQL + validators BSD (HALT actif)
│   ├── schemas.ts          # Schémas Zod partagés
│   ├── session.ts          # JWT HMAC-SHA256
│   ├── permissions.ts      # Permissions granulaires
│   ├── rateLimit.ts        # Rate limiting Redis + fallback mémoire
│   ├── db.ts                # Singleton PrismaClient (adapter pg)
│   └── metricCollector.ts  # ML Phase 1 — collecte terrain
├── stores/planningStore.ts # État Zustand central (plans, undo/redo, sync DB)
├── workers/                # 4 workers BullMQ (voir §6)
├── services/                # Intégrations externes (Nessy, Trimble, trafficAggregator…)
├── providers/               # DataProvider (chargement initial), TradeProvider
├── middleware.ts            # Garde d'accès : JWT, headers d'identité, RBAC
└── generated/prisma/         # Client Prisma généré (sortie custom, pas node_modules)
```

## 4. Flux de données — optimisation VRP

```
Planificateur → POST /api/optimize
    → BullMQ enqueue (Redis)
    → Worker VRP consomme le job
    → Valhalla : matrice de distances PL
    → MV-ALNS 7 étapes → solution optimale
    → Résultat stocké Redis → SSE vers client
    → Plan sauvegardé PostgreSQL
```

Si Redis ou le Worker VRP est indisponible, `/api/optimize` bascule en mode synchrone dans le
process Next.js lui-même (`mode: "sync"` dans la réponse) — dégradé mais fonctionnel.

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

Fallback in-memory/polling si Redis indisponible (fonctionnel, pas distribué multi-instance).
Limite : 200 connexions SSE simultanées par tenant par défaut
(`SSE_MAX_CONNECTIONS_PER_TENANT`).

## 6. Workers BullMQ

| Worker | Fichier | Rôle | Commande |
|--------|---------|------|----------|
| VRP | `src/workers/vrpWorker.ts` | Consomme la queue `vrp-jobs`, pipeline 7 étapes, démarre aussi le worker de rétention audit | `npm run worker` |
| ML | `src/workers/mlProfileWorker.ts` | CRON nocturne 02:30, recalcule les coefficients ML par tenant | `npm run worker:ml` |
| Missions récurrentes | `src/workers/recurringMissionsWorker.ts` | Génère quotidiennement les missions à venir depuis les `MissionTemplate` actifs | `npm run worker:recurring` |
| Rétention audit | `src/workers/auditRetentionWorker.ts` | Démarré par `vrpWorker.ts`, purge `AuditLog` > 90 jours | (auto) |

## 7. Résilience et modes dégradés

| Panne | Impact | Comportement |
|-------|--------|-------------|
| Redis indisponible | Cache perdu, BullMQ hors service, rate limit non partagé | VRP synchrone, SSE polling, fallback in-memory |
| Valhalla/OSRM indisponible | Distances PL dégradées | Repli haversine automatique |
| Worker VRP absent | Pas d'optimisation asynchrone | VRP synchrone dans Next.js |
| PostgreSQL indisponible | Toutes les API → 500 | Health check → `status: "outage"` |
| API externe routage indisponible | Dégradation qualité VRP | Fallback Valhalla → OSRM → haversine |

`src/lib/circuitBreaker.ts` protège les appels aux API externes de routage (CLOSED → OPEN
après N échecs → HALF_OPEN).

## 8. Six secteurs d'activité (trades)

Le champ `trade` du tenant adapte le vocabulaire UI (`src/lib/trades.ts`, `TradeProvider`) :
`collecte_recyclage`, `livraison_distribution`, `btp_location`, `demenagement`,
`maintenance_sav`, `coursier_express`. Des trades personnalisés au-delà de ces 6 peuvent être
créés par un superadmin.

## 9. Cartographie (MapLibre GL JS)

Migré depuis Leaflet le 2026-09-22 (voir `MIGRATION_MAPLIBRE_LOG.md` à la racine pour
l'historique complet de la migration — 3 investigations : worker Web Worker non résolu par
webpack, icônes emoji rendues via glyphes au lieu d'images, et couverture du test
LiveTrackingMap). Deux cartes dans l'app, toutes deux `'use client'` et chargées via
`next/dynamic({ ssr: false })` depuis leur onglet (MapLibre dépend de `window` et de WebGL,
jamais de rendu serveur) :

| Composant | Où | Rôle |
|---|---|---|
| `src/components/FleetMap.tsx` | `ToursTab.tsx` (onglet Tournées) | Carte principale : tournées, missions, exutoires, dépôts, positions live, heatmap densité |
| `src/components/LiveTrackingMap.tsx` | `TelematicsTab.tsx` (onglet Télématique) | Mini-carte de suivi GPS temps réel |

### Infrastructure partagée

- **`src/hooks/useMapLibreMap.ts`** — hook réutilisable qui centralise l'initialisation, le
  cycle de vie (nettoyage `map.remove()` au démontage, sûr sous React 18 StrictMode) et les
  contrôles par défaut. Toute nouvelle carte doit passer par lui plutôt que d'instancier
  `maplibregl.Map` directement.
- **`src/lib/maplibre/config.ts`** — sélection du fond de carte et paramètres de vue par
  défaut (`pitch: 45`, `bearing: -17`, `maxPitch: 70` — choisis pour révéler l'extrusion 3D
  des bâtiments du style sans nuire à la lisibilité aux niveaux de zoom réellement utilisés,
  ~10-14).
- **`src/lib/maplibre/coords.ts`** — conversions explicites lat/lng ↔ lng/lat. Le reste de
  l'app (Prisma, Zod, `TourStep`) stocke toujours `{lat, lng}` séparés (convention héritée de
  Leaflet) ; MapLibre et GeoJSON attendent `[lng, lat]`. **Toujours** passer par
  `toLngLat({lat, lng})` au point d'entrée d'une donnée dans une API MapLibre — jamais de
  tuple brut.
- **`src/lib/maplibre/escapeHtml.ts`** — les popups/tooltips MapLibre sont du HTML brut
  (`Popup.setHTML()`), contrairement aux anciens `<Tooltip>`/`<Popup>` JSX Leaflet qui
  échappaient automatiquement via React. Toute chaîne issue de la base (nom client, adresse,
  nom chauffeur) interpolée dans du HTML de popup **doit** passer par `escapeHtml()`.

### Fond de carte

`basemapStyleUrl()` (dans `config.ts`) choisit le style vectoriel :

- **Sans clé (défaut)** : [OpenFreeMap Liberty](https://tiles.openfreemap.org/styles/liberty)
  — gratuit, sans inscription, vérifié en direct (200 OK) lors de la migration. Schéma
  OpenMapTiles, sprite + glyphes inclus, contient nativement une couche bâtiments 3D
  (`building-3d`, `fill-extrusion`, `minzoom: 14`) à partir de vraies hauteurs OSM — aucune
  couche personnalisée à ajouter pour la 3D.
- **Avec clé MapTiler** : dès que `NEXT_PUBLIC_MAPTILER_KEY` est définie (voir
  [configuration.md](configuration.md)), bascule automatique vers le style vectoriel
  MapTiler (`streets-v2`) — aucun changement de code requis. **Non vérifié en direct** dans
  cet environnement (pas de clé disponible) — à valider manuellement après obtention d'une
  clé.
- `demotiles.maplibre.org` n'est jamais utilisé (trop pauvre pour un usage réel).

### Attribution

Obligatoire légalement (données OpenStreetMap). `useMapLibreMap` ajoute toujours un
`AttributionControl` compact ; en mode sans clé, l'attribution OSM + OpenFreeMap est fournie
explicitement (`OPENFREEMAP_ATTRIBUTION` dans `config.ts`) car le style OpenFreeMap ne
l'embarque pas lui-même. En mode MapTiler, l'attribution est déjà intégrée au style et
n'a pas besoin d'être dupliquée.

### Ajouter une nouvelle couche

1. Utiliser `useMapLibreMap(containerRef, options)` pour obtenir `{ map, isStyleLoaded }`.
2. Attendre `isStyleLoaded === true` avant tout `map.addSource`/`addLayer` (jamais avant —
   voir le commentaire dans `useMapLibreMap.ts`).
3. Pour des données nombreuses (> quelques dizaines de points) : une source GeoJSON +
   couche(s) `circle`/`symbol`/`line`/`fill`, mises à jour via `source.setData()` — jamais un
   `Marker` DOM par élément (coûteux au-delà de quelques dizaines). `FleetMap.tsx` (missions,
   routes, heatmap) en est la référence dans ce projet.
4. Pour un petit nombre de marqueurs personnalisés (dépôts, exutoires) : `maplibregl.Marker`
   avec un élément HTML, comme dans `FleetMap.tsx`/`LiveTrackingMap.tsx`.
5. Convertir toute coordonnée `{lat,lng}` via `toLngLat()` avant de l'utiliser dans MapLibre.
6. Échapper toute chaîne issue de la base avant de l'interpoler dans un `Popup.setHTML()`.

### Web Worker — pourquoi il est servi statiquement, et versionné

MapLibre GL JS résout normalement l'URL de son Web Worker via `import.meta.url` à l'intérieur
de son propre module bundlé. Une fois ce module re-bundlé par le webpack de Next.js, cette
résolution échoue silencieusement (pas d'erreur, pas de warning) — le Worker créé pointe vers
un script vide et le chargement des tuiles vectorielles ne se termine jamais (voir
`MIGRATION_MAPLIBRE_LOG.md`, "Investigation 2", pour la preuve complète en instrumentant
`window.Worker`).

Le correctif : `maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL)` (dans `useMapLibreMap.ts`, appelé
avant toute instanciation de `maplibregl.Map`) pointe vers deux fichiers statiques servis depuis
`public/maplibre/<version>/` — des copies verbatim de `node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs`
et `maplibre-gl-shared.mjs`. Le segment `<version>` est **dérivé automatiquement** de la version
installée de `maplibre-gl` (jamais codé en dur) : `next.config.mjs` lit
`node_modules/maplibre-gl/package.json` au build et injecte `NEXT_PUBLIC_MAPLIBRE_VERSION` ;
`src/lib/maplibre/config.ts` construit `MAPLIBRE_WORKER_URL` à partir de cette variable et lève
une erreur explicite si elle est absente (échec bruyant, pas de repli silencieux).

**Mettre à jour `maplibre-gl`** :

1. `npm install maplibre-gl@<nouvelle-version>` (ou `npm update maplibre-gl`).
2. `node scripts/sync-maplibre-worker.js` — recopie les deux fichiers dans
   `public/maplibre/<nouvelle-version>/` et supprime l'ancien dossier de version. Ce script
   tourne aussi automatiquement en `postinstall`, donc une simple étape 1 suffit en pratique ;
   l'étape 2 n'est nécessaire qu'après un `npm install --ignore-scripts`.
3. `npx vitest run src/lib/maplibre/__tests__/workerSync.test.ts` — vérifie par hash SHA-256 que
   les fichiers commités sous `public/maplibre/` correspondent bien, octet pour octet, à ceux de
   `node_modules/maplibre-gl/dist/`. Échoue avec un message nommant la commande exacte à lancer
   si oubli.
4. `git add public/maplibre .gitattributes` puis committer — ces fichiers sont marqués `-text`
   dans `.gitattributes` (binaires, pas de conversion de fin de ligne) : nécessaire car
   `core.autocrlf=true` sous Windows réécrirait sinon silencieusement LF en CRLF au checkout et
   casserait la comparaison de hash.
5. Lancer `npm run build && npm run start` puis `npx playwright test e2e/maplibre-worker-exemption.spec.ts e2e/maplibre-migration.spec.ts --project=chromium` contre ce build de production — confirme que le nouveau chemin versionné répond bien sans session, et que la carte se charge toujours.

Ces deux fichiers sont exemptés de l'authentification dans `src/middleware.ts` (`matcher`),
scopé **exactement** à `maplibre/<n'importe-quelle-version>/maplibre-gl-(worker|shared).mjs` —
jamais un préfixe `maplibre/` ouvert. `e2e/maplibre-worker-exemption.spec.ts` prouve cette
portée exacte (200 sans cookie sur ces deux fichiers, 307→`/login` sur une route voisine non
exemptée, échec sur un nom de fichier inventé sous le même préfixe).

`npm ci --ignore-scripts` (utilisé par CI et le build Docker) saute `postinstall`, donc ne
relance jamais `sync-maplibre-worker.js` — sans conséquence, puisque les fichiers versionnés
sont déjà commités dans le dépôt et que `workerSync.test.ts` est la seule garantie nécessaire
qu'ils sont à jour.

### Ajouter une nouvelle icône de marqueur

Deux mécanismes de rendu coexistent, selon le nombre de marqueurs :

- **Peu de marqueurs (dépôts, exutoires, positions live)** : `maplibregl.Marker` avec un
  élément HTML (`makeDivIconEl()` dans `FleetMap.tsx`). Un emoji ou une icône SVG placé en
  `textContent`/`innerHTML` s'affiche via le rendu HTML/CSS natif du navigateur — aucune
  contrainte particulière, aucun rapport avec le pipeline de glyphes MapLibre. Pour ajouter une
  icône ici, il suffit de modifier la fonction qui construit le HTML de l'élément.
- **Beaucoup de marqueurs (missions, via `fleetmap-missions-label`)** : une couche `symbol` avec
  `icon-image`, jamais `text-field`. Le serveur de glyphes public d'OpenFreeMap (et la plupart
  des serveurs de glyphes tiers) n'a **aucune couverture pictographique/emoji** — un `text-field`
  contenant un emoji littéral déclenche un 404 sur la plage Unicode correspondante et s'affiche
  vide (voir `MIGRATION_MAPLIBRE_LOG.md`, "Investigation 3"). `src/lib/maplibre/emojiIcon.ts`
  fournit :
  - `ensureEmojiImage(map, emoji)` — dessine l'emoji sur un `<canvas>` offscreen à
    `devicePixelRatio` et l'enregistre via `map.addImage(emoji, imageData, { pixelRatio })`.
    Idempotent (`map.hasImage()` fait foi, pas de cache local), donc peut être appelé à chaque
    mise à jour de la source sans coût significatif.
  - `installEmojiImageFallback(map)` — filet de sécurité `styleimagemissing` pour tout id
    référencé avant que `ensureEmojiImage` n'ait tourné pour lui.

  Pour ajouter un nouveau type d'icône dans une couche `symbol` à fort volume : appeler
  `ensureEmojiImage(map, monEmoji)` avant chaque `source.setData()` qui référence cet emoji
  (voir l'effet « Mission points source data » de `FleetMap.tsx`), et s'assurer que la couche
  utilise `layout: { 'icon-image': ['get', 'monChamp'] }` — jamais `text-field` pour un
  pictogramme.
