# Pathélix — Architecture

Vue technique : composants, flux, moteur d'optimisation, temps réel, hors ligne, modèle de
données. Exploitation : OPERATIONS.md. Sécurité : SECURITY.md.

## 1. Stack

| Couche | Choix |
|---|---|
| Application | Next.js 15.5 App Router, TypeScript 5.9 strict, sortie `standalone` |
| Données | PostgreSQL 16, Prisma 7 + `@prisma/adapter-pg` (client généré dans `src/generated/prisma`) |
| État client | Zustand (`src/stores/planningStore.ts`), TanStack Query 5 |
| UI | Tailwind 3, Geist + Inter, MapLibre GL JS 6 |
| Validation | Zod 4 (`src/lib/schemas.ts` + schémas de route) |
| Files / cache | BullMQ 5 + ioredis (optionnel, repli en mémoire) |
| Routage | Valhalla (poids-lourds, auto-hébergé) → API externe optionnelle (Trimble/HERE) → haversine |
| Observabilité | Sentry, Prometheus (`/api/metrics/prometheus`), OpenTelemetry optionnel |
| Tests | Vitest (unitaires/intégration), Playwright (E2E) |

## 2. Organisation du code

```
src/
├── middleware.ts        Authentification, ré-injection de l'identité, RBAC, clés API, rate limit global
├── app/
│   ├── (site)/          Site vitrine public : son propre layout racine, sa feuille de style
│   │                    (site.css + tailwind.site.config.js), aucun provider de l'application.
│   │                    Pages statiques ; médias dans public/site-media, captures dans src/assets/site
│   ├── (app)/           Application (mêmes URL qu'avant) : layout avec providers et service worker
│   ├── (app)/admin/     Interface exploitant/admin (onglets : tableau de bord, missions, tournées,
│   │                    statistiques, historique, catalogue, chauffeurs, camions, exutoires,
│   │                    récurrentes, utilisateurs, audit, télématique, paramètres, planning semaine)
│   ├── (app)/driver/[id]/  Application chauffeur (mobile, hors ligne)
│   ├── (app)/superadmin/   Console multi-organisations
│   ├── (app)/track/[token]/ Suivi client public
│   └── api/             ~120 routes REST
├── lib/
│   ├── tenantDb.ts      getTenantDb() — isolation structurelle (voir SECURITY.md)
│   ├── data/context.ts  getRequestContext() — seule source d'identité dans les routes
│   ├── vrp/             Moteur d'optimisation (§4)
│   ├── apiKeyAuth.ts, sessionRevocation.ts, permissions.ts, tenantRefs.ts, outboundUrl.ts
│   ├── syncQueue.ts, idempotency.ts   Synchronisation hors ligne (§6)
│   └── trackdechets/    Client GraphQL + validations BSD (HALT dans le code)
├── workers/             vrp, pdf, mlProfile, recurringMissions, auditRetention (+ lifecycle.ts)
├── components/          admin/, driver/, site/ (site vitrine), ui/, cartes (FleetMap, LiveTrackingMap)
├── providers/           DataProvider (chargement du planning), TradeProvider (vocabulaire métier)
└── stores/planningStore.ts  Plans du jour, annuler/rétablir, synchronisation base
```

Le vocabulaire de l'interface s'adapte au secteur de l'organisation (`trade` : collecte &
recyclage, livraison, BTP & location, déménagement, maintenance, coursier — et secteurs
personnalisés créés par un superadmin), via `src/lib/trades.ts`.

## 3. Modèle de données

35 modèles (`prisma/schema.prisma`), presque tous rattachés à `Tenant`. Points structurants :

- `Mission` : 10 types — `POSER RETIRER ECHANGER VIDER PAUSE CHARGER_IMMEDIAT DEPLACER TASSER
  EXPEDIER ALLER_RETOUR`. `VIDER` (passage à l'exutoire) et `PAUSE` (CE 561) sont générés par
  l'optimiseur, jamais saisis. `linkedExutoireId` lie une mission à un exutoire préféré.
- `Plan` : une tournée = un chauffeur × une date ; `missions` est un JSON `PlannedMission[]`
  (étapes ordonnées, synthétiques comprises), `statuses` l'avancement terrain par mission.
- `TenantSettings` (vitesse, heure de départ, `valhallaFactor` 1,60 par défaut, pondérations),
  `TenantMLProfile` (coefficients appris).
- `IdempotencyKey` (rejeu des actions hors ligne), `ApiKey`, `AuditLog`, `DriverPosition`,
  `Integration` (config chiffrée), `TrackdechetsAccount`/`Bsd`, `MissionTemplate` (récurrence,
  missions liées par `generatedFromTemplateId`), `PlanningNote`.

Migrations dans `prisma/migrations/` (`migrate dev` en développement, `migrate deploy` au
démarrage du conteneur).

## 4. Moteur d'optimisation (`src/lib/vrp/`)

MV-ALNS : recherche adaptative à grand voisinage multi-variantes. Entrée : missions, chauffeurs
(dépôt, capacité, gabarit, compétences), exutoires (horaires, déchets acceptés), options de
l'organisation. Sortie : `PlannedMission[]` par chauffeur, missions non affectées, avertissements.

Pipeline (`index.ts`) :

1. **Préparation** — coefficients ML et familiarité chauffeur × site ; missions dédupliquées ;
   bennes incompatibles avec toute la flotte écartées (non affectées, avec avertissement).
2. **Matrice de distances** — API externe si configurée, sinon Valhalla (profil poids-lourd le
   plus contraignant de la flotte, découpage en blocs, cache Redis 24 h par clé
   coordonnées + gabarit, circuit breaker, budget de 20 s), sinon haversine.
3. **Décomposition** — au-delà de 20 chauffeurs, secteurs géographiques résolus séparément
   (en parallèle avec `VRP_USE_THREADS=true` ; chaque thread reçoit une sous-matrice
   sérialisée). Un secteur en échec repart de sa construction initiale, jamais perdu.
4. **MV-ALNS** — destructions (aléatoire, pire coût, cluster, missions liées, chaînes, contraintes violées, pires tournées) et réparations (glouton,
   regret-2/3/5 sur les k meilleures *tournées*, candidates choisies par proximité au point le
   plus proche de chaque tournée), recuit simulé, CVaR stochastique, front de Pareto optionnel.
5. **Post-optimisation** — or-opt inter-secteurs, 3-opt sur les pires tournées, chaînes
   d'éjection, compactage, regroupement par type de déchet, affectation forcée des P1.
6. **Formatage** — insertion des passages à l'exutoire, pauses CE 561/2006, étapes dépôt.
7. **Garde de sortie** — chaque mission d'entrée apparaît exactement une fois (dans une tournée
   ou en non affectée) ; doublons retirés ; benne trop grande pour son camion retirée. Toute
   correction produit un avertissement.

**Coût d'une tournée** (`routeCost.ts`) : un seul simulateur pas à pas (trajets matrice ou
haversine avec facteur trafic, coupures de conduite, fenêtres horaires, échéances P1, capacité
et vidages, compétences, temps de travail, pause déjeuner). Les états de préfixe et les deltas
d'insertion/retrait rejouent ce même simulateur depuis le dernier état non affecté : **un delta
est exactement la différence de deux coûts complets**, propriété vérifiée par un test aléatoire
(`deltaConsistency.test.ts`). Le budget temps est réparti après construction de la matrice.

**Ré-optimisation en cours de journée** (`/api/optimize/live`) : départ depuis la position réelle
du chauffeur, étapes terminées ou verrouillées conservées, missions non replanifiées laissées à
leur chauffeur.

**Apprentissage** : `metricCollector.ts` enregistre les durées réelles ; `mlProfileWorker`
recalcule chaque nuit des coefficients par organisation/chauffeur/type/site, avec trois garde-fous
(échantillon minimal, écart maximal, rejet des valeurs aberrantes).

## 5. Temps réel

- L'avancement terrain est écrit dans `Plan.statuses` (verrou de ligne, idempotent) puis publié
  sur Redis (`driver-status:<tenant>`) ; `GET /api/sse/driver-status` le pousse aux exploitants,
  qui rechargent l'état depuis la base à la connexion. Sans Redis : diffusion en mémoire
  (mono-instance) et rechargement périodique.
- Positions GPS : application chauffeur (toutes les 30 s) ou boîtiers (Geotab, Samsara, OBD).
  Toutes les sources écrivent dans `DriverPosition` ; la carte, l'historique de vitesse (minutes
  à l'heure de l'organisation) et l'agrégateur de trafic du worker VRP relisent cette table
  (`src/lib/positions.ts`) — aucune position ne vit dans la mémoire d'un process.
- Limite : 200 connexions SSE par organisation.

## 6. Application chauffeur hors ligne

- Service Worker (`public/sw.js`) + IndexedDB : la feuille de route est en cache ; chaque action
  (statut, photo, signature, poids, incident) est mise en file avec une `Idempotency-Key`.
- Une seule synchronisation à la fois entre la page et le Service Worker (Web Locks), reprise
  avec temporisation croissante ; 401 met la file en pause (reconnexion) au lieu de la vider ;
  la déconnexion purge les données locales.
- Côté serveur, `withIdempotency()` réserve la clé atomiquement : un rejeu renvoie la réponse
  d'origine sans ré-exécuter l'action.

## 7. Workers et tâches de fond

| Worker | File | Déclenchement |
|---|---|---|
| `vrpWorker` | `vrp-optimization` | `POST /api/optimize` (repli synchrone 15 s si indisponible) ; warm-start J-7 |
| `pdfWorker` | `pdf-generation` | Feuilles de route, rapport mensuel (process séparé : `@react-pdf` ne fonctionne pas dans le bundle serveur Next) |
| `mlProfileWorker` | `ml-profiles` | Quotidien 03:00 (`--once` pour un calcul ponctuel) |
| `recurringMissionsWorker` | `recurring-missions` | Quotidien + rattrapage au démarrage |
| `auditRetentionWorker` | `audit-retention` | Quotidien 02:00, suppressions par lots |

Tous valident l'environnement au démarrage et s'arrêtent proprement sur SIGTERM
(`workers/lifecycle.ts`). Les erreurs de données d'un job VRP sont non réessayables.

## 8. Résilience

| Panne | Comportement |
|---|---|
| Redis | Optimisation synchrone, SSE en mémoire, rate limiting local ; appels bornés par timeout (jamais de requête bloquée) ; `/api/ready` reste 200. Une connexion devenue muette (coupure réseau sans fermeture) est détectée par un PING toutes les 5 s, abandonnée, puis reconstruite automatiquement au retour de Redis (essais à 5, 10, 20… 60 s) |
| Valhalla / API de routage | Circuit breaker puis haversine ; `routingSource` indique la source utilisée |
| Worker VRP | Mode synchrone |
| Worker PDF | 503 explicite |
| Appels sortants (ERP, webhooks, push, météo) | Timeouts, pas de retry sur les POST non idempotents |

## 9. Cartographie

MapLibre GL JS, deux cartes client (`FleetMap` dans Tournées, `LiveTrackingMap` dans Télématique),
via le hook `useMapLibreMap`. Fond OpenFreeMap Liberty sans clé, MapTiler si
`NEXT_PUBLIC_MAPTILER_KEY`. Coordonnées converties par `toLngLat()` ; tout texte en popup passe
par `escapeHtml()`. Le Web Worker MapLibre est servi depuis `public/maplibre/<version>/` (copie
versionnée, synchronisée par `scripts/sync-maplibre-worker.js` en `postinstall`, vérifiée par
`workerSync.test.ts`) car webpack casse sa résolution d'URL. Les icônes nombreuses passent par
`icon-image` (`emojiIcon.ts`), jamais par `text-field` (pas de glyphes emoji).
