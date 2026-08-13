# Pathélix — API & Intégrations

> Référence complète des routes API, webhooks, intégrations et variables d'environnement.
> Vérifiée contre le code source réel (juin 2026).

---

## Table des matières

1. [Authentification de l'API](#1-authentification-de-lapi)
2. [Routes par domaine](#2-routes-par-domaine)
3. [Webhooks entrants](#3-webhooks-entrants)
4. [Intégrations externes](#4-intégrations-externes)
5. [Variables d'environnement](#5-variables-denvironnement)

---

## 1. Authentification de l'API

Toutes les routes (sauf Auth, pages publiques et webhooks) nécessitent un JWT valide dans le cookie `session`.

```
Cookie: session=<JWT_HMAC_SHA256>
```

- JWT signé HMAC-SHA256 via Web Crypto API
- Stocké en cookie HttpOnly SameSite=Strict Secure
- Expiry : 24h
- Payload : `{ sub, role, tenantId, driverRef?, trade?, iat, exp }`

Les webhooks utilisent leur propre mécanisme d'authentification (HMAC/Bearer/API key — voir section 3).

---

## 2. Routes par domaine

### Authentification

| Méthode | Route | Description | Auth |
|---------|-------|-------------|------|
| POST | `/api/auth/login` | Connexion email + mot de passe, retourne cookie JWT | Public |
| POST | `/api/auth/logout` | Déconnexion, supprime le cookie | Authentifié |
| GET | `/api/auth/me` | Session courante | Authentifié |
| POST | `/api/auth/change-password` | Changer le mot de passe | Authentifié |

### Utilisateurs

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/users` | Lister les utilisateurs du tenant |
| POST | `/api/users` | Créer un utilisateur |
| GET | `/api/users/[id]` | Détail d'un utilisateur |
| PUT | `/api/users/[id]` | Modifier un utilisateur |
| DELETE | `/api/users/[id]` | Supprimer un utilisateur |
| POST | `/api/users/[id]/reset-password` | Réinitialiser le mot de passe |
| GET | `/api/permissions` | Lister les permissions d'un utilisateur |
| PUT | `/api/permissions` | Modifier les permissions d'un utilisateur |

### Chauffeurs

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/drivers` | Lister les chauffeurs (filtres : secteur, archive) |
| POST | `/api/drivers` | Créer un chauffeur |
| GET | `/api/drivers/[id]` | Détail d'un chauffeur |
| PUT | `/api/drivers/[id]` | Modifier un chauffeur |
| DELETE | `/api/drivers/[id]` | Archiver/supprimer un chauffeur |
| GET | `/api/driver-list` | Liste légère id + nom (pour les selects UI) |
| GET | `/api/driver-photos` | Lister les photos de chauffeurs |
| POST | `/api/driver-photos` | Uploader une photo de chauffeur |
| DELETE | `/api/driver-photos` | Supprimer une photo de chauffeur |
| GET | `/api/drivers/compliance` | Rapport de conformité chauffeurs |

### Indisponibilités chauffeurs

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/driver-unavailability` | Lister les indisponibilités (congés, absences) |
| POST | `/api/driver-unavailability` | Créer une indisponibilité |
| DELETE | `/api/driver-unavailability/[id]` | Supprimer une indisponibilité |

### Missions

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/missions` | Lister les missions (filtres : date, archive, priorité) |
| POST | `/api/missions` | Créer une mission (validée par Zod MissionSchema) |
| GET | `/api/missions/[id]` | Détail d'une mission |
| PUT | `/api/missions/[id]` | Modifier une mission |
| DELETE | `/api/missions/[id]` | Archiver/supprimer une mission |
| GET | `/api/missions/[id]/proof` | Preuve de livraison |
| GET | `/api/missions/queue` | Missions en file d'attente (non affectées) |
| POST | `/api/missions/parse-natural` | Parser une mission en langage naturel (Ollama) |

### Templates de missions

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/templates` | Lister les templates de missions |
| POST | `/api/templates` | Créer un template (Zod TemplateSchema complet) |
| PUT | `/api/templates/[id]` | Modifier un template |
| DELETE | `/api/templates/[id]` | Supprimer un template |

### Véhicules

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/vehicles` | Lister les véhicules |
| POST | `/api/vehicles` | Créer un véhicule |
| GET | `/api/vehicles/[id]` | Détail d'un véhicule |
| PUT | `/api/vehicles/[id]` | Modifier un véhicule (gabarit, assurance, entretien) |
| DELETE | `/api/vehicles/[id]` | Archiver/supprimer un véhicule |

### Entretien et carburant véhicules

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/maintenance` | Lister les entretiens |
| POST | `/api/maintenance` | Créer un entretien |
| PUT | `/api/maintenance/[id]` | Modifier un entretien |
| DELETE | `/api/maintenance/[id]` | Supprimer un entretien |
| GET | `/api/fuel-records` | Lister les enregistrements carburant |
| POST | `/api/fuel-records` | Créer un enregistrement carburant |
| PUT | `/api/fuel-records/[id]` | Modifier un enregistrement |
| DELETE | `/api/fuel-records/[id]` | Supprimer un enregistrement |

### Clients

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/clients` | Lister les clients |
| POST | `/api/clients` | Créer un client (fiche commerciale, SIRET, contrat) |
| GET | `/api/clients/[id]` | Détail d'un client |
| PUT | `/api/clients/[id]` | Modifier un client |
| DELETE | `/api/clients/[id]` | Archiver/supprimer un client |

### Sites

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/sites` | Lister les sites |
| POST | `/api/sites` | Créer un site (adresse géoréférencée, horaires d'accès) |
| PUT | `/api/sites/[id]` | Modifier un site |
| DELETE | `/api/sites/[id]` | Archiver/supprimer un site |

### Produits par site

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/site-products` | Lister les produits/déchets par site |
| POST | `/api/site-products` | Créer un produit (type, benne, durée, exutoire par défaut) |
| PUT | `/api/site-products/[id]` | Modifier un produit |
| DELETE | `/api/site-products/[id]` | Supprimer un produit |

### Exutoires

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/exutoires` | Lister les exutoires (décharges, centres de tri) |
| POST | `/api/exutoires` | Créer un exutoire |
| GET | `/api/exutoires/[id]` | Détail d'un exutoire |
| PUT | `/api/exutoires/[id]` | Modifier un exutoire |
| DELETE | `/api/exutoires/[id]` | Supprimer un exutoire |

### Tournées (Plans)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/plans` | Lister les tournées (filtre par date) |
| POST | `/api/plans` | Créer/mettre à jour une tournée |
| DELETE | `/api/plans` | Supprimer une tournée |
| GET | `/api/driver-plan/[id]` | Tournée du jour d'un chauffeur (vue mobile) |

### Optimisation VRP

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/optimize` | Lancer optimisation VRP asynchrone (BullMQ) → 202 + jobId |
| GET | `/api/optimize/[jobId]` | Statut et résultat d'un job VRP |
| POST | `/api/optimize/live` | Re-optimisation temps réel synchrone (~10s) |
| POST | `/api/optimize/resequence` | Re-séquencer les missions d'un seul chauffeur |
| POST | `/api/redistribute` | Redistribuer les missions entre chauffeurs |
| GET | `/api/weekly-plan` | Récupérer le planning hebdomadaire |
| POST | `/api/weekly-plan` | Créer/mettre à jour le planning hebdomadaire |
| GET | `/api/plans/p1-risk` | Scoring de risque P1 (missions urgentes) |

### Routage et navigation

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/routing` | Calculer un itinéraire (Valhalla/OSRM) |
| POST | `/api/routing` | Calculer une matrice de distances |
| POST | `/api/navigation` | Itinéraire turn-by-turn |
| POST | `/api/trimble/route-calc` | Calcul d'itinéraire via Trimble Maps API |

### Temps réel et GPS

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/driver-status` | Récupérer les statuts des chauffeurs |
| POST | `/api/driver-status` | Mettre à jour le statut d'un chauffeur |
| POST | `/api/driver-status/update` | Mise à jour statut mission (terrain chauffeur) |
| GET | `/api/driver-position` | Positions GPS des chauffeurs |
| POST | `/api/driver-position` | Enregistrer une position GPS |
| GET | `/api/sse/driver-status` | Flux SSE temps réel (Redis Pub/Sub) |
| GET | `/api/sse/incidents` | Flux SSE incidents en temps réel |
| GET | `/api/tracking` | ETA dynamique + suivi client (polling 30s) |

### ML et prédictions

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/predictions` | Prédictions ML de durée d'intervention |
| GET | `/api/predictions/delay` | Scoring de retard prédit |
| GET | `/api/metrics` | Métriques d'intervention (collecte ML phase 1) |
| GET | `/api/kpi-history` | Historique des KPI de performance |

### Livraison et incidents

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/delivery-proof` | Soumettre une preuve de livraison (photo/signature) |
| GET | `/api/incidents` | Lister les incidents |
| POST | `/api/incidents` | Créer un incident |
| GET | `/api/mission-comments` | Lister les commentaires de mission |
| POST | `/api/mission-comments` | Ajouter un commentaire |
| DELETE | `/api/mission-comments/[id]` | Supprimer un commentaire |

### Historique et rapports

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/history` | Lister les snapshots de tournées |
| POST | `/api/history` | Sauvegarder un snapshot de tournée |
| GET | `/api/history/[id]` | Récupérer un snapshot |
| DELETE | `/api/history/[id]` | Supprimer un snapshot |
| GET | `/api/reports` | Générer des rapports analytics |
| GET | `/api/reports/co2` | Rapport CO2 |
| POST | `/api/reports/pdf` | Générer un rapport PDF |
| POST | `/api/tours/pdf` | Générer le PDF d'une tournée |

### Paramètres et configuration

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/settings` | Récupérer les paramètres du tenant |
| PUT | `/api/settings` | Modifier les paramètres du tenant |
| GET | `/api/holidays` | Lister les jours fériés |
| POST | `/api/holidays` | Créer un jour férié |
| DELETE | `/api/holidays/[id]` | Supprimer un jour férié |
| GET | `/api/features` | Feature flags du tenant |

### Intégrations

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/integrations` | Lister les intégrations du tenant |
| POST | `/api/integrations` | Configurer une intégration |
| POST | `/api/integrations/test` | Tester la connexion d'une intégration |

### Import et export

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/import` | Import massif CSV/JSON (missions, clients, sites, véhicules, chauffeurs) |

### Clés API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/api-keys` | Lister les clés API du tenant |
| POST | `/api/api-keys` | Créer une clé API (nom, scopes, expiration) |

### Notifications push

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/push/subscribe` | S'abonner aux notifications push (WebPush) |
| POST | `/api/push/notify` | Envoyer une notification push |

### Audit et conformité

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/audit` | Consulter les logs d'audit du tenant |
| DELETE | `/api/audit` | Purger les logs d'audit (superadmin uniquement) |

### Trackdéchets (BSDD)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/trackdechets/bsds` | Lister les BSDD du tenant |
| POST | `/api/trackdechets/bsds` | Créer un BSDD |
| GET | `/api/trackdechets/bsds/[id]` | Détail d'un BSDD |
| PUT | `/api/trackdechets/bsds/[id]` | Modifier un BSDD |
| POST | `/api/trackdechets/bsds/[id]/sign` | Signer un BSDD (producteur/transporteur) |
| POST | `/api/webhooks/trackdechets` | Webhook entrant Trackdéchets (HMAC) |

### Onboarding

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/onboarding` | État d'avancement de l'onboarding |
| POST | `/api/onboarding` | Créer un nouveau tenant via l'assistant |

### Monitoring et santé

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/health` | Health check détaillé (DB, Redis, queue, circuit breakers) |
| GET | `/api/ready` | Readiness probe (DB + Redis — load balancers) |
| GET | `/api/status` | Page de statut publique |
| GET | `/api/metrics` | Métriques de performance (latence P50/P95/P99) |
| GET | `/api/metrics/prometheus` | Métriques format Prometheus |
| GET | `/api/docs` | Spec OpenAPI JSON |
| GET | `/api/benchmark` | Benchmark VRP interne |

### SuperAdmin (cross-tenant)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/superadmin/stats` | Statistiques globales cross-tenant |
| GET | `/api/superadmin/tenants` | Lister tous les tenants |
| POST | `/api/superadmin/tenants` | Créer un tenant |
| PUT | `/api/superadmin/tenants/[id]` | Modifier un tenant |
| GET | `/api/superadmin/users` | Lister tous les utilisateurs |
| GET | `/api/superadmin/system-health` | État de santé global multi-tenant |
| GET | `/api/superadmin/ml-status` | Maturité ML par tenant |
| POST | `/api/superadmin/impersonate` | Démarrer une session d'impersonation |

---

## 3. Webhooks entrants

Tous les webhooks sont exposés sous `/api/webhooks/`. Chacun a son propre mécanisme d'authentification.

### Nessy (ERP)

```
POST /api/webhooks/nessy
```

- **Auth** : HMAC-SHA256 sur le body. Header : `x-nessy-signature: sha256=<hex>`
- **Secret** : par tenant, configuré via `/api/integrations` (type `nessy`, champ `webhookSecret`,
  chiffré en base — voir `configCrypto.ts`), **pas** une variable d'environnement globale
- **Tenant** : résolu automatiquement en trouvant quelle intégration Nessy activée vérifie la
  signature de la requête — **jamais** déduit d'un header `x-tenant-id` fourni par l'appelant
  (correctif A1/M12, voir `AUDIT_BUGS.md` — l'ancien design faisait confiance à un secret unique
  partagé entre tous les tenants + un tenant auto-déclaré par l'appelant, ce qui permettait à
  n'importe qui connaissant le secret global d'usurper n'importe quel tenant)
- **Idempotence** : déduplication SHA-256 + Redis (évite le re-traitement des replays)
- **Payload** : `{ missions: [...], sentAt: ISO8601 }`
- **Validation** : timestamp `sentAt` ≤ 5 min, batch ≤ 500 missions
- **Réponse** : `200 { received: N }` ou `200 { deduplicated: true }`

**⚠️ Breaking change (A1)** : `NESSY_WEBHOOK_SECRET` (variable d'environnement globale) n'est
plus utilisée pour l'authentification du webhook. Chaque tenant utilisant Nessy doit configurer
son propre secret via l'onglet Intégrations de l'admin (ou `POST /api/integrations` avec
`{type:"nessy", config:{webhookSecret:"..."}}`), puis reconfigurer son côté Nessy/ERP pour signer
avec ce nouveau secret propre au tenant. Sans cette migration, le webhook Nessy de ce tenant
renverra `401 Signature invalide` pour toute requête.

### OBD (télématique)

```
POST /api/webhooks/obd
```

- **Auth** : Bearer token. Header : `Authorization: Bearer <secret>`
- **Secret** : par tenant, configuré via `/api/integrations` (type `obd`, champ `webhookSecret`,
  chiffré en base), **pas** une variable d'environnement globale — même pattern que Nessy/Geotab/
  Samsara
- **Tenant** : résolu en trouvant quelle intégration OBD activée possède le secret fourni ; chaque
  `driverId` du payload est ensuite vérifié comme appartenant à ce tenant avant tout enregistrement
  (correctif A1/M3 — avant cela, n'importe quel `driverId` de n'importe quel tenant pouvait être
  écrit par quiconque connaissait le token global unique)
- **Payload** : `{ driverId, lat, lng, speedKmh, timestamp? }`
- **Stockage** : in-memory `obdStore` (pruné automatiquement après 500 lectures par driver)
- **Rate limit** : appliqué via `createRateLimiter`

**⚠️ Breaking change (A1)** : `OBD_WEBHOOK_TOKEN` (variable d'environnement globale) n'est plus
utilisée. Chaque tenant utilisant l'intégration OBD générique doit configurer son propre secret via
l'onglet Intégrations, puis reconfigurer son boîtier/passerelle OBD pour envoyer ce token propre au
tenant en header `Authorization: Bearer <secret>`.

### Geotab

```
POST /api/webhooks/geotab
```

- **Auth** : API key en header
- **Données** : positions GPS et télématiques Geotab

### Samsara

```
POST /api/webhooks/samsara
```

- **Auth** : API key en header
- **Données** : positions GPS et télématiques Samsara

### AI Engine (callback)

```
POST /api/ai/callback
```

- **Auth** : HMAC-SHA256. Header : `x-ai-signature`
- **Secret** : `AI_CALLBACK_SECRET`
- **Usage** : callback machine-to-machine de l'AI Engine Python (résultat OCR)
- **Note** : pas de contexte JWT (intentionnel, route machine-to-machine)

---

## 4. Intégrations externes

### Routage poids-lourds

| Intégration | Type | Activation | Usage |
|-------------|------|------------|-------|
| **Trimble Maps** | API externe | `ROUTING_API_TYPE=trimble` + `ROUTING_API_KEY` | Données PL certifiées, trafic temps réel |
| **HERE Maps** | API externe | `ROUTING_API_TYPE=here` + `ROUTING_API_KEY` | Alternative Trimble |
| **API générique** | API externe | `ROUTING_API_TYPE=generic` + `ROUTING_API_URL` | Tout service compatible |
| **Valhalla** | Auto-hébergé | `VALHALLA_URL` | Profil véhicule dynamique (principal) |
| **OSRM** | Auto-hébergé | `OSRM_URL` | Repli statique |

### Télématique / GPS

| Intégration | Mécanisme | Config |
|-------------|-----------|--------|
| **Geotab** | Webhook entrant + API key | Via `/api/integrations` + `GEOTAB_API_KEY` |
| **Samsara** | Webhook entrant + API key | Via `/api/integrations` + `SAMSARA_API_KEY` |
| **OBD générique** | Webhook entrant Bearer | Via `/api/integrations` (type `obd`, secret par tenant) |

### ERP / Métier

| Intégration | Mécanisme | Config |
|-------------|-----------|--------|
| **Nessy** | Webhook entrant HMAC | Via `/api/integrations` (type `nessy`, secret par tenant) |
| **Trackdéchets** | API GraphQL + webhooks | `TRACKDECHETS_API_URL` + token chiffré par tenant |

### IA / ML

| Intégration | Mécanisme | Config |
|-------------|-----------|--------|
| **Ollama** | HTTP interne | `OLLAMA_URL` (pour parse-natural) |
| **AI Engine Python** | Redis queue + callback HMAC | `AI_ENGINE_URL` + `AI_CALLBACK_SECRET` |

### Observabilité

| Intégration | Usage | Config |
|-------------|-------|--------|
| **Sentry** | Error tracking | `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` |

---

## 5. Variables d'environnement

### Requises (application ne démarre pas sans elles)

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/pathelix` |
| `SESSION_SECRET` | Clé JWT HMAC-SHA256 (≥ 32 chars) | `super-secret-32-chars-minimum!!!` |

### Comportement par défaut

| Variable | Défaut | Description |
|----------|--------|-------------|
| `USE_MOCK_DATA` | (absent = mock ON) | `false` pour activer la vraie DB. Pattern : `!== 'false'` |
| `FORCE_HTTPS` | `true` | `false` pour désactiver HSTS (dev local) |

### Infrastructure

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | URL Redis. Optionnel — fallback in-memory si absent |
| `DB_POOL_SIZE` | Nombre de connexions PostgreSQL (défaut : 20) |
| `SSE_MAX_CONNECTIONS_PER_TENANT` | Max connexions SSE simultanées par tenant (défaut : 50) |

### Routage

| Variable | Description |
|----------|-------------|
| `VALHALLA_URL` | URL Valhalla auto-hébergé |
| `OSRM_URL` | URL OSRM auto-hébergé (repli) |
| `ROUTING_API_TYPE` | `trimble` / `here` / `generic` (API externe) |
| `ROUTING_API_KEY` | Clé API externe de routage |
| `ROUTING_API_URL` | URL base pour type `generic` ou override Trimble |

### VRP Worker

| Variable | Description |
|----------|-------------|
| `VRP_USE_THREADS` | `true` pour activer Worker Threads parallèles (grandes flottes) |
| `VRP_THREAD_CONCURRENCY` | Nombre de threads secteur (défaut : cœurs CPU − 4) |
| `VRP_CONCURRENCY` | Max jobs VRP simultanés par worker (défaut : 1) |

### Webhooks

| Variable | Description |
|----------|-------------|
| `NESSY_WEBHOOK_SECRET` | **Dépréciée (A1)** — n'authentifie plus le webhook, secret désormais par tenant via `/api/integrations` |
| `OBD_WEBHOOK_TOKEN` | **Dépréciée (A1)** — n'authentifie plus le webhook, secret désormais par tenant via `/api/integrations` |
| `AI_CALLBACK_SECRET` | Secret HMAC pour callback AI Engine |
| `TRACKDECHETS_API_URL` | URL API Trackdéchets (`sandbox.` ou `api.` — défaut sandbox) |

### Clés de chiffrement

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | Clé AES-256-GCM pour chiffrement tokens intégrations (32 bytes hex) |

### Push notifications

| Variable | Description |
|----------|-------------|
| `VAPID_PUBLIC_KEY` | Clé publique VAPID (WebPush) |
| `VAPID_PRIVATE_KEY` | Clé privée VAPID |
| `VAPID_SUBJECT` | Email contact VAPID (`mailto:...`) |

### IA

| Variable | Description |
|----------|-------------|
| `OLLAMA_URL` | URL Ollama pour parse-natural (défaut : `http://localhost:11434`) |
| `AI_ENGINE_URL` | URL AI Engine Python (OCR) |

### Superadmin initial

| Variable | Description |
|----------|-------------|
| `SUPERADMIN_EMAIL` | Email du compte superadmin initial (pour `db:seed-superadmin`) |
| `SUPERADMIN_PASSWORD` | Mot de passe superadmin initial |

### Observabilité

| Variable | Description |
|----------|-------------|
| `SENTRY_DSN` | DSN Sentry pour l'error tracking |
| `SENTRY_AUTH_TOKEN` | Token pour upload des source maps |
