# Pathélix — API & Intégrations

> Référence des routes API, webhooks, intégrations externes et variables d'environnement.
> Vérifiée contre le code source réel (août 2026). Sécurité/permissions détaillées : [TECHNICAL.md](TECHNICAL.md).

---

## 1. Authentification de l'API

Toutes les routes (sauf Auth, pages publiques et webhooks) nécessitent un JWT valide dans le cookie `session` (`HttpOnly`, `SameSite=Strict`, `Secure`, 24h). Payload : `{ sub, role, tenantId, driverRef?, trade?, iat, exp }`.

Les webhooks utilisent leur propre mécanisme d'authentification (HMAC/Bearer/API key — section 3).

---

## 2. Routes par domaine

### Authentification

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/auth/login` | Connexion, retourne cookie JWT (rate-limité 5/60s par IP) |
| POST | `/api/auth/logout` | Déconnexion |
| GET | `/api/auth/me` | Session courante |
| POST | `/api/auth/change-password` | Changer son propre mot de passe |

### Utilisateurs & Permissions

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST | `/api/users` | Lister / créer un utilisateur (`manage_users`) |
| GET/PUT/DELETE | `/api/users/[id]` | Détail / modifier / supprimer (`manage_users`) |
| POST | `/api/users/[id]/reset-password` | Réinitialiser le mot de passe |
| GET/PUT | `/api/permissions` | Lire / modifier les permissions granulaires d'un utilisateur |

### Chauffeurs

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST | `/api/drivers` | Lister / créer (`manage_drivers`) |
| GET/PUT/DELETE | `/api/drivers/[id]` | Détail / modifier / archiver |
| GET | `/api/driver-list` | Liste légère id+nom pour les selects UI |
| GET/POST/DELETE | `/api/driver-photos` | Photos de profil chauffeur |
| GET | `/api/drivers/compliance` | Rapport de conformité |
| GET/POST | `/api/driver-unavailability` | Indisponibilités |
| DELETE | `/api/driver-unavailability/[id]` | Supprimer une indisponibilité |

### Missions

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST | `/api/missions` | Lister / créer (`manage_missions`) |
| GET/PUT/DELETE | `/api/missions/[id]` | Détail / modifier / archiver |
| GET | `/api/missions/[id]/proof` | Preuve de livraison |
| GET | `/api/missions/queue` | Missions non affectées |
| POST | `/api/missions/parse-natural` | Parser une mission en langage naturel (Ollama) |
| GET/POST/PUT/DELETE | `/api/templates[/[id]]` | Templates de missions récurrentes (`manage_missions`) |

### Véhicules

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST | `/api/vehicles` | Lister / créer (`manage_vehicles`) |
| GET/PUT/DELETE | `/api/vehicles/[id]` | Détail / modifier / archiver |
| GET/POST/PUT/DELETE | `/api/maintenance[/[id]]` | Entretiens véhicule |
| GET/POST/PUT/DELETE | `/api/fuel-records[/[id]]` | Enregistrements carburant |

### Clients, Sites, Exutoires

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST/PUT/DELETE | `/api/clients[/[id]]` | Fiches clients |
| GET/POST/PUT/DELETE | `/api/sites[/[id]]` | Sites géoréférencés |
| GET/POST/PUT/DELETE | `/api/site-products[/[id]]` | Produits/déchets par site |
| GET/POST/PUT/DELETE | `/api/exutoires[/[id]]` | Exutoires (`manage_exutoires`) |

### Tournées et optimisation

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST/DELETE | `/api/plans` | Tournées (filtre par date) |
| GET | `/api/driver-plan/[id]` | Tournée du jour d'un chauffeur (vue mobile) |
| POST | `/api/optimize` | Lancer optimisation VRP asynchrone → 202 + jobId |
| GET | `/api/optimize/[jobId]` | Statut/résultat d'un job |
| POST | `/api/optimize/live` | Re-optimisation synchrone (~10s) |
| POST | `/api/optimize/resequence` | Re-séquencer un chauffeur |
| POST | `/api/redistribute` | Redistribuer entre chauffeurs |
| GET/POST | `/api/weekly-plan` | Planning hebdomadaire |
| GET | `/api/plans/p1-risk` | Scoring de risque P1 |

### Routage, temps réel, GPS

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST | `/api/routing` | Itinéraire / matrice de distances |
| POST | `/api/navigation` | Itinéraire turn-by-turn |
| POST | `/api/trimble/route-calc` | Calcul via Trimble Maps |
| GET/POST | `/api/driver-status[/update]` | Statuts chauffeurs |
| GET/POST | `/api/driver-position` | Positions GPS |
| GET | `/api/sse/driver-status`, `/api/sse/incidents` | Flux SSE temps réel |
| GET | `/api/tracking` | ETA dynamique (polling) |

### ML, livraison, incidents

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/predictions[/delay]` | Prédictions ML durée / retard |
| GET | `/api/metrics` | Métriques d'intervention |
| GET | `/api/kpi-history` | Historique des KPI |
| POST | `/api/delivery-proof` | Preuve de livraison (photo/signature) |
| GET/POST | `/api/incidents` | Incidents |
| GET/POST/DELETE | `/api/mission-comments[/[id]]` | Commentaires mission |

### Historique, rapports, paramètres

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST/DELETE | `/api/history[/[id]]` | Snapshots de tournées |
| GET | `/api/reports[/co2]` | Rapports analytics / CO2 |
| POST | `/api/reports/pdf`, `/api/tours/pdf` | Génération PDF |
| GET/PUT | `/api/settings` | Paramètres tenant (`manage_settings`) |
| GET/POST/DELETE | `/api/holidays[/[id]]` | Jours fériés |
| GET | `/api/features` | Feature flags |

### Intégrations, clés API, import/export

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST | `/api/integrations` | Intégrations tenant (`manage_integrations`) |
| POST | `/api/integrations/test` | Tester une connexion |
| GET/POST | `/api/api-keys` | Clés API tenant (`api_access`) |
| POST | `/api/import` | Import massif CSV/JSON |

### Audit

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/audit` | Consulter les logs d'audit du tenant |
| DELETE | `/api/audit` | Purger les logs (réservé `superadmin`, tracé via `logSuperadminAction`) |

### Trackdéchets (BSD)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST | `/api/bsds` | BSD du tenant |
| GET/PUT | `/api/bsds/[id]` | Détail / modifier |
| POST | `/api/bsds/[id]/sign` | Signer (producteur/transporteur) |
| GET/POST | `/api/trackdechets/accounts[/[id]]` | Compte Trackdéchets (token chiffré) |

### IA / OCR

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/ai/ocr` | Soumettre une image (ticket de pesée) pour OCR — statut réel voir TECHNICAL.md §9 |
| POST | `/api/ai/callback` | Callback signé HMAC de l'AI Engine Python |
| GET | `/api/ai/jobs[/[id]]` | Statut des jobs IA du tenant |

### Onboarding, monitoring, superadmin

| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST | `/api/onboarding` | Assistant de création de tenant |
| GET | `/api/health` | Health check détaillé (DB, Redis, queue, circuit breakers) |
| GET | `/api/ready` | Readiness probe |
| GET | `/api/metrics/prometheus` | Métriques format Prometheus |
| GET/POST | `/api/superadmin/tenants[/[id]]` | Gestion tenants cross-tenant |
| GET | `/api/superadmin/users`, `/system-health`, `/ml-status`, `/stats` | Vues cross-tenant |
| POST | `/api/superadmin/impersonate` | Démarrer une impersonation |

---

## 3. Webhooks entrants

Tous exposés sous `/api/webhooks/`. **Aucun n'utilise de secret global** — chaque secret/token est configuré par tenant via `/api/integrations`, et le tenant appelant est résolu en trouvant quelle intégration activée matche le secret/signature fourni, jamais depuis un header client-asserté.

### Nessy (ERP)

```
POST /api/webhooks/nessy
```

- Auth : HMAC-SHA256 sur le body, header `x-nessy-signature: sha256=<hex>`
- Idempotence : déduplication SHA-256 + Redis
- Payload : `{ missions: [...], sentAt: ISO8601 }` — `sentAt` ≤ 5 min, batch ≤ 500 missions

### OBD générique

```
POST /api/webhooks/obd
```

- Auth : `Authorization: Bearer <secret par tenant>`
- Chaque `driverId` du payload est vérifié comme appartenant au tenant résolu avant tout enregistrement
- Payload : `{ driverId, lat, lng, speedKmh, timestamp? }`
- Stockage in-memory (`obdStore`), pruné après 500 lectures/driver

### Geotab / Samsara

```
POST /api/webhooks/geotab
POST /api/webhooks/samsara
```

Auth par clé API, positions GPS et télématique.

### Trackdéchets

```
POST /api/webhooks/trackdechets
```

Auth HMAC-SHA256 (`TRACKDECHETS_WEBHOOK_SECRET`). Met à jour le statut d'un BSD suivi.

### AI Engine (callback)

```
POST /api/ai/callback
```

Auth HMAC-SHA256 (`AI_CALLBACK_SECRET`), header `x-ai-signature`. Callback machine-to-machine, pas de contexte JWT (intentionnel).

---

## 4. Intégrations externes

| Intégration | Mécanisme | Config |
|-------------|-----------|--------|
| Trimble Maps / HERE | API externe de routage | `ROUTING_API_TYPE` (`trimble`/`here`/`generic`) + `ROUTING_API_KEY` |
| Valhalla | Auto-hébergé | `VALHALLA_URL` (principal) |
| OSRM | Auto-hébergé | `OSRM_URL` (repli) |
| Geotab / Samsara | Webhook entrant + clé API par tenant | Via `/api/integrations` |
| OBD générique | Webhook entrant Bearer par tenant | Via `/api/integrations` |
| Nessy | Webhook entrant HMAC par tenant | Via `/api/integrations` |
| Trackdéchets | API GraphQL + webhooks | `TRACKDECHETS_API_URL` + token chiffré par tenant — **HALT actif, voir OPERATIONS.md** |
| Ollama | HTTP interne | `OLLAMA_URL` (parse-natural) |
| AI Engine Python | Redis queue + callback HMAC | `AI_ENGINE_URL` + `AI_CALLBACK_SECRET` — code existant, pas orchestré en prod |
| Sentry | Error tracking | `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` |

---

## 5. Variables d'environnement

### Requises

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Clé JWT HMAC-SHA256 (≥ 32 chars) |

### Comportement par défaut

| Variable | Défaut | Description |
|----------|--------|-------------|
| `USE_MOCK_DATA` | absent = mock ON | `false` pour activer la vraie DB — pattern `!== 'false'`, jamais `=== 'true'` |
| `FORCE_HTTPS` | `true` | `false` pour désactiver HSTS (dev local) |

### Infrastructure

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Optionnel — fallback in-memory si absent |
| `DB_POOL_SIZE` | Connexions PostgreSQL par processus (défaut 20) |
| `SSE_MAX_CONNECTIONS_PER_TENANT` | Défaut 200 |

### Routage

| Variable | Description |
|----------|-------------|
| `VALHALLA_URL`, `OSRM_URL` | Moteurs auto-hébergés |
| `ROUTING_API_TYPE`, `ROUTING_API_KEY`, `ROUTING_API_URL` | API externe (optionnel) |
| `URBAN_CENTERS_JSON` | Override des centres urbains pour le bonus trafic (défaut : 5 villes Rhône-Alpes codées en dur) |

### VRP Worker

| Variable | Description |
|----------|-------------|
| `VRP_USE_THREADS` | `true` pour activer les Worker Threads parallèles |
| `VRP_THREAD_CONCURRENCY` | Défaut : cœurs CPU − 4 |
| `VRP_CONCURRENCY` | Jobs simultanés par worker (défaut 1) |

### Secrets et chiffrement

| Variable | Description |
|----------|-------------|
| `AI_CALLBACK_SECRET` | HMAC callback AI Engine |
| `TRACKDECHETS_API_URL` | `sandbox.` ou `api.` — défaut sandbox (HALT) |
| `TRACKDECHETS_ENCRYPTION_KEY` | AES-256-GCM, 64 hex chars, chiffrement token TD |
| `TRACKDECHETS_WEBHOOK_SECRET` | HMAC webhook TD entrant |
| `INTEGRATION_ENCRYPTION_KEY` | AES-256-GCM pour `Integration.config` (Nessy/OBD/Geotab/Samsara) |

Les webhooks Nessy/OBD n'utilisent **plus** de secret global côté environnement — tout est configuré par tenant via `/api/integrations`.

### Push notifications

| Variable | Description |
|----------|-------------|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | WebPush |

### IA

| Variable | Description |
|----------|-------------|
| `OLLAMA_URL` | Défaut `http://localhost:11434` |
| `AI_ENGINE_URL` | URL de l'AI Engine Python (non orchestré en prod actuellement) |

### Superadmin initial

| Variable | Description |
|----------|-------------|
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | Pour `npm run db:seed-superadmin` |

### Observabilité

| Variable | Description |
|----------|-------------|
| `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | Error tracking + source maps |
| `OTEL_ENABLED` | `true` pour activer l'export OpenTelemetry (désactivé par défaut) |
