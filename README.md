# Pathélix

SaaS B2B de gestion de flotte et d'optimisation de tournées pour entreprises multi-secteurs.
Architecture 100 % cloud — serveur dédié unique, réseau Docker bridge interne.

---

## Table des matières

1. [Description](#description)
2. [Architecture multi-secteur](#architecture-multi-secteur--6-métiers)
3. [Stack technique](#stack-technique)
4. [Architecture multi-tenant](#architecture-multi-tenant)
5. [Rôles utilisateur](#rôles-utilisateur)
6. [Invariants critiques](#invariants-critiques)
7. [Démarrage rapide](#démarrage-rapide-développement)
8. [Scripts disponibles](#scripts-disponibles)
9. [Pages de l'application](#pages-de-lapplication)
10. [API — Référence complète](#api--référence-complète)
11. [Variables d'environnement](#variables-denvironnement)
12. [Documentation](#documentation)
13. [Tests](#testing)

---

## Description

Pathélix est une plateforme de **planification et d'optimisation de tournées** conçue pour les entreprises opérant des flottes de véhicules industriels. Le moteur VRP (Vehicle Routing Problem) calcule automatiquement le meilleur itinéraire pour chaque chauffeur, en tenant compte des contraintes terrain réelles : fenêtres horaires, capacités véhicules, gabarits PL, pauses réglementaires CE 561/2006, compétences requises, et dépendances entre missions.

Le produit est **multi-secteur** : un même moteur VRP s'adapte à 6 secteurs d'activité via un système de vocabulaire par tenant (labels, icônes, types de missions disponibles). L'architecture est **100 % cloud** : un seul serveur dédié héberge l'ensemble des services (Next.js, PostgreSQL, Redis, Valhalla, Worker VRP, AI Engine) connectés via un réseau Docker bridge interne. Aucune dépendance physique, SLA datacenter 99,9 %+.

---

## Architecture multi-secteur — 6 métiers

Un même moteur s'adapte au vocabulaire de chaque secteur via le champ `trade` du tenant et le modèle `CustomTrade`.

| Secteur | Conducteur | Véhicule | Point de décharge | Types de missions |
|---------|-----------|----------|-------------------|-------------------|
| ♻️ Collecte & Recyclage | Chauffeur | Camion | Exutoire | Poser, Retirer, Echanger, Vider, Tasser |
| 📦 Livraison & Distribution | Livreur | Véhicule | Entrepôt | Livraison, Enlèvement, Echange, Chargement |
| 🏗️ BTP & Location | Chauffeur | Camion | Dépôt matériel | Livraison, Récupération, Déplacement, Retour dépôt |
| 🏠 Déménagement | Déménageur | Camion | Garde-meuble | Livraison, Enlèvement, Transfert, Aller-Retour |
| 🔧 Maintenance & SAV | Technicien | Véhicule | Atelier | Installation, Désinstallation, Remplacement, Expédition |
| ⚡ Coursier & Express | Coursier | Véhicule | Hub | Dépôt, Ramassage, Express, Chargement immédiat |

Types de missions dans le schéma Prisma (enum `MissionType`) : `POSER`, `RETIRER`, `ECHANGER`, `VIDER`, `PAUSE`, `CHARGER_IMMEDIAT`, `DEPLACER`, `TASSER`, `EXPEDIER`, `ALLER_RETOUR`.

`VIDER` et `PAUSE` sont synthétiques — générés par le VRP, jamais créés manuellement.

---

## Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Framework | Next.js App Router | 15.5.x |
| Langage | TypeScript strict | 5.9.x |
| Base de données | PostgreSQL 16 + Prisma (`@prisma/adapter-pg`) | Prisma 7.x |
| State management | Zustand | 4.5.x |
| Data fetching | TanStack React Query | 5.x |
| Virtualisation listes | TanStack React Virtual | 3.x |
| Styling | Tailwind CSS | 3.4.x |
| Cartographie | Leaflet + React-Leaflet | 1.9.x / 4.2.x |
| Validation | Zod | 4.x |
| File d'attente | BullMQ + Redis (ioredis) | BullMQ 5.x |
| Authentification | JWT HMAC-SHA256 + cookies HttpOnly | — |
| Monitoring | Sentry | 10.x |
| Internationalisation | next-intl | 4.x |
| Moteur de routage | Valhalla (self-hosted) + OSRM (fallback) | — |
| Recherche floue | Fuse.js | 7.x |
| Images | Sharp | 0.34.x |
| Tests | Vitest + @vitest/coverage-v8 | 3.x |
| Stockage offline | idb-keyval (IndexedDB) | 6.x |
| Runtime | Node.js | ≥18.17.0 |

---

## Architecture multi-tenant

Isolation par `tenantId` sur toutes les tables. Chaque entreprise dispose de son propre espace complètement isolé.

```
Tenant (entreprise)
 ├── trade (secteur d'activité — vocabulaire UI dynamique)
 ├── plan (FREE / PRO / ENTERPRISE)
 ├── maxDrivers, maxMissions (limites du plan)
 ├── TenantSettings (configuration, branding, quotas, valhallaFactor ML)
 ├── Users (admin, dispatcher, driver) + UserPermissions
 ├── Drivers (chauffeurs, dépôts, compétences, infos RH)
 │    ├── DriverPositions (positions GPS temps réel)
 │    └── DriverUnavailabilities (congés, absences)
 ├── Vehicles (véhicules, gabarit PL, assurance, entretien)
 │    ├── MaintenanceRecords (historique entretien)
 │    └── FuelRecords (historique carburant)
 ├── Clients (fiche client, SIRET, contrat)
 │    └── ClientSites (association client-site N:N)
 ├── Sites (adresses géoréférencées, horaires d'accès)
 │    └── SiteProducts (catalogue produits/déchets par site)
 ├── Missions (interventions planifiables, 10 types)
 │    └── MissionComments (commentaires chauffeur/admin)
 ├── Plans (tournées optimisées, métriques de performance)
 ├── WeeklyPlans (planification hebdomadaire)
 ├── TourHistory (snapshots historiques)
 ├── Exutoires (décharges, centres de tri, horaires)
 ├── Holidays (jours fériés, récurrents ou ponctuels)
 ├── AuditLogs (traçabilité complète des actions)
 ├── Integrations (Nessy, Trimble, Geotab, Samsara...)
 ├── ApiKeys (accès programmatique avec scopes)
 ├── InterventionMetrics (données ML phase 1)
 └── TenantMLProfiles (coefficients ML phase 2)
```

Le schéma Prisma comporte **30 modèles**, **3 enums** (`TenantPlan`, `UserRole`, `MissionType`) et un système complet d'indexation. `CustomTrade` est un modèle global (sans `tenantId`), pas un enum.

---

## Rôles utilisateur

| Rôle | Description | Accès |
|------|-------------|-------|
| `SUPERADMIN` | Administrateur de la plateforme. Gestion cross-tenant, impersonation, télémétrie système, métiers personnalisés. | `/superadmin` |
| `ADMIN` | Administrateur d'un tenant. Gestion complète : chauffeurs, véhicules, missions, clients, paramètres, intégrations, clés API, rapports. | `/admin` (tous les onglets) |
| `DISPATCHER` | Planificateur de tournées. Crée et optimise les tournées, gère les missions, suit les chauffeurs en temps réel. Permissions granulaires configurables. | `/admin` (onglets autorisés) |
| `DRIVER` | Chauffeur terrain. Consulte sa tournée du jour sur mobile, met à jour le statut de chaque mission, envoie sa position GPS. | `/driver/[id]` |

Permissions granulaires via `UserPermission` : `optimize`, `manage_drivers`, `manage_exutoires`, `manage_missions`, `manage_vehicles`, `manage_users`, `view_reports`, `view_costs`, `manage_settings`, `api_access`, `manage_integrations`.

---

## Invariants critiques

Ces règles ne doivent jamais être enfreintes :

1. **Isolation multi-tenant** : chaque requête Prisma filtre par `tenantId`. Aucune donnée cross-tenant.
2. **Chaîne d'en-têtes Auth** : le middleware supprime `x-user-id`, `x-user-role`, `x-tenant-id` des requêtes entrantes, puis les réinjecte depuis le JWT vérifié. Les route handlers lisent le contexte uniquement via `getRequestContext(req)` (`src/lib/data/context.ts`).
3. **CSP canonique** : `next.config.mjs` est l'unique source de vérité pour les en-têtes de sécurité. Ne pas ajouter d'en-têtes de sécurité dans `middleware.ts`.
4. **Flag mock** : `process.env.USE_MOCK_DATA !== 'false'` (défaut ON). Toutes les routes API utilisent ce pattern — jamais `=== 'true'`.
5. **Intégrité VRP** : `src/lib/vrp/` implémente MV-ALNS v6. Le pipeline 7 étapes, les 3 boucliers ML qualité, et la conformité CE 561/2006 doivent être préservés.
6. **Validation Zod aux frontières** : tous les POST/PUT valident avec un schéma Zod typé avant toute écriture en base. Schémas partagés dans `src/lib/schemas.ts`, schémas locaux pour les routes spécifiques.

---

## Démarrage rapide (développement)

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer l'environnement
cp .env.example .env.local
# Éditer : DATABASE_URL, SESSION_SECRET, REDIS_URL (optionnel)

# 3. Générer le client Prisma
npx prisma generate

# 4. Appliquer les migrations
npx prisma migrate dev

# 5. Peupler la base de données
npm run db:seed              # Jeu de données réaliste
npm run db:seed-superadmin   # Compte super admin

# 6. Démarrer le serveur de développement
npm run dev
```

Le serveur démarre sur `http://localhost:3000`. Redis est optionnel — l'application fonctionne en mode dégradé (in-memory) sans Redis.

---

## Scripts disponibles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Serveur de développement Next.js |
| `npm run build` | Build de production |
| `npm run start` | Démarrer le serveur de production |
| `npm run lint` | Linting ESLint |
| `npm run test` | Tests unitaires (Vitest, exécution unique) |
| `npm run test:watch` | Tests unitaires en mode watch |
| `npm run test:coverage` | Tests avec rapport de couverture (v8) |
| `npm run worker` | Worker BullMQ pour les optimisations VRP asynchrones |
| `npm run worker:ml` | Worker BullMQ pour le calcul des profils ML (CRON nocturne 2h30) |
| `npm run db:seed` | Seed avec données réalistes |
| `npm run db:seed-massive` | Seed massif (150 chauffeurs, 1500 missions) |
| `npm run db:seed-superadmin` | Créer le compte super admin |
| `npm run db:studio` | Interface graphique Prisma Studio |
| `npm run db:migrate` | Appliquer les migrations Prisma |

---

## Pages de l'application

| Route | Description | Accès |
|-------|-------------|-------|
| `/` | Page de connexion | Public |
| `/login` | Page de connexion (alternative) | Public |
| `/admin` | Panneau d'administration (13+ onglets : tournées, chauffeurs, véhicules, missions, clients, sites, exutoires, rapports, paramètres, intégrations, KPI, Gantt...) | Admin, Dispatcher |
| `/driver/[id]` | Interface mobile chauffeur : tournée du jour, navigation, mise à jour de statut, commentaires | Driver |
| `/driver` | Page d'accueil chauffeur (redirection) | Driver |
| `/superadmin` | Console super admin (5 onglets : tenants, utilisateurs, métiers, télémétrie, audit) | SuperAdmin |
| `/help` | Documentation utilisateur + FAQ | Public |
| `/status` | Page de statut publique (SLA 99.9%) | Public |
| `/onboarding` | Assistant de création de compte tenant | Public |
| `/api-docs` | Documentation API Swagger UI | Authentifié |

---

## API — Référence complète

L'API REST expose **82+ endpoints** regroupés par domaine fonctionnel. Toutes les routes (sauf Auth et les pages publiques) requièrent un JWT valide dans le cookie `session`.

### Authentification

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/auth/login` | Connexion (email + mot de passe), retourne un cookie JWT |
| POST | `/api/auth/logout` | Déconnexion, suppression du cookie de session |
| GET | `/api/auth/me` | Récupérer la session courante |
| POST | `/api/auth/change-password` | Changer le mot de passe de l'utilisateur connecté |

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
| GET | `/api/driver-list` | Liste légère des chauffeurs (id, nom) pour les selects |
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
| POST | `/api/missions` | Créer une mission |
| GET | `/api/missions/[id]` | Détail d'une mission |
| PUT | `/api/missions/[id]` | Modifier une mission |
| DELETE | `/api/missions/[id]` | Archiver/supprimer une mission |
| GET | `/api/missions/[id]/proof` | Preuve de livraison d'une mission |
| GET | `/api/missions/queue` | Missions en file d'attente (non affectées) |
| POST | `/api/missions/parse-natural` | Parser une mission en langage naturel (Ollama) |

### Templates de missions

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/templates` | Lister les templates de missions |
| POST | `/api/templates` | Créer un template |
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
| POST | `/api/optimize` | Lancer une optimisation VRP asynchrone (BullMQ) |
| GET | `/api/optimize/[jobId]` | Récupérer le statut et le résultat d'un job VRP |
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
| POST | `/api/navigation` | Calculer un itinéraire de navigation turn-by-turn |
| POST | `/api/trimble/route-calc` | Calcul d'itinéraire via Trimble Maps API |

### Temps réel et GPS

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/driver-status` | Récupérer les statuts des chauffeurs |
| POST | `/api/driver-status` | Mettre à jour le statut d'un chauffeur |
| POST | `/api/driver-status/update` | Mise à jour de statut mission (chauffeur terrain) |
| GET | `/api/driver-position` | Récupérer les positions GPS des chauffeurs |
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
| GET | `/api/features` | Récupérer les feature flags du tenant |

### Intégrations

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/integrations` | Lister les intégrations du tenant |
| POST | `/api/integrations` | Configurer une intégration (Nessy, Trimble, Geotab, Samsara) |
| POST | `/api/integrations/test` | Tester la connexion d'une intégration |

### Import et export

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/import` | Import massif de données (CSV/JSON) |

### Clés API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/api-keys` | Lister les clés API du tenant |
| POST | `/api/api-keys` | Créer une clé API (nom, scopes, expiration) |

### Notifications push

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/push/subscribe` | S'abonner aux notifications push |
| POST | `/api/push/notify` | Envoyer une notification push |

### Audit et conformité

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/audit` | Consulter les logs d'audit du tenant |
| DELETE | `/api/audit` | Purger les logs d'audit |

### Onboarding

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/onboarding` | Récupérer l'état d'avancement de l'onboarding |
| POST | `/api/onboarding` | Créer un nouveau tenant via l'assistant |

### Monitoring et santé

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/health` | Health check détaillé (DB, Redis, queue, circuit breakers) |
| GET | `/api/ready` | Readiness probe (DB + Redis — utilisé par les load balancers) |
| GET | `/api/status` | Page de statut publique |
| GET | `/api/metrics` | Métriques de performance (latence P50/P95/P99) |
| GET | `/api/metrics/prometheus` | Métriques au format Prometheus |
| GET | `/api/docs` | Spec OpenAPI JSON |
| GET | `/api/benchmark` | Benchmark VRP interne |

### Webhooks entrants

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/webhooks/nessy` | Réception de missions depuis l'ERP Nessy (HMAC-SHA256) |
| POST | `/api/webhooks/obd` | Données télématiques OBD (Bearer token) |
| POST | `/api/webhooks/geotab` | Données GPS et télématiques Geotab |
| POST | `/api/webhooks/samsara` | Données GPS et télématiques Samsara |

### SuperAdmin (cross-tenant)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/superadmin/stats` | Statistiques globales cross-tenant |
| GET | `/api/superadmin/tenants` | Lister tous les tenants |
| POST | `/api/superadmin/tenants` | Créer un tenant |
| GET/PUT/DELETE | `/api/superadmin/tenants/[id]` | CRUD tenant |
| PUT | `/api/superadmin/tenants/[id]/settings` | Modifier les paramètres d'un tenant |
| GET | `/api/superadmin/tenants/[id]/data` | Exporter les données d'un tenant |
| POST | `/api/superadmin/tenants/[id]/resources` | Gérer les ressources d'un tenant |
| POST | `/api/superadmin/tenants/[id]/suspend` | Suspendre un tenant |
| POST | `/api/superadmin/tenants/[id]/activate` | Réactiver un tenant suspendu |
| POST | `/api/superadmin/tenants/[id]/purge-cache` | Purger le cache Redis d'un tenant |
| GET/POST | `/api/superadmin/users` | Lister/créer des utilisateurs cross-tenant |
| GET/PUT/DELETE | `/api/superadmin/users/[id]` | CRUD utilisateur cross-tenant |
| POST | `/api/superadmin/impersonate` | Impersonation d'un utilisateur (token 15 min) |
| POST | `/api/superadmin/exit-impersonation` | Quitter l'impersonation |
| GET/POST | `/api/superadmin/trades` | CRUD métiers personnalisés |
| PUT/DELETE | `/api/superadmin/trades/[id]` | Modifier/supprimer un métier |
| GET | `/api/superadmin/audit-logs` | Logs d'audit cross-tenant |
| GET | `/api/superadmin/system-health` | Télémétrie système (Valhalla, OSRM, Redis, DB) |
| GET | `/api/superadmin/ml-status` | Maturité ML par tenant |

---

## Variables d'environnement

Copier `.env.example` en `.env.local` et remplir les valeurs.

### Obligatoires

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Connection string PostgreSQL (ex: `postgresql://postgres:postgres@localhost:5432/pathelix`) |
| `SESSION_SECRET` | Secret pour signer les JWT de session (minimum 32 caractères) |

### Base de données et cache

| Variable | Description | Défaut |
|----------|-------------|--------|
| `USE_MOCK_DATA` | `false` = base PostgreSQL réelle. Pattern : `!== 'false'` | (mock ON) |
| `DB_POOL_SIZE` | Taille du pool de connexions PostgreSQL | `20` |
| `REDIS_URL` | URL Redis complète (ex: `redis://localhost:6379`) | — |
| `REDIS_HOST` | Hôte Redis (alternative à REDIS_URL) | `localhost` |
| `REDIS_PORT` | Port Redis | `6379` |
| `REDIS_PASSWORD` | Mot de passe Redis | — |
| `REDIS_TLS` | Activer TLS pour Redis | — |

### Moteurs de routage

| Variable | Description | Défaut |
|----------|-------------|--------|
| `VALHALLA_URL` | URL du serveur Valhalla (ex: `http://10.8.0.2:8002`) | — |
| `VALHALLA_FALLBACK_URL` | URL Valhalla de secours | — |
| `VALHALLA_TIMEOUT_MS` | Timeout des requêtes Valhalla (ms) | `15000` |
| `OSRM_URL` | URL du serveur OSRM | — |
| `OSRM_MAX_TABLE_SIZE` | Taille max table OSRM | `100` |
| `ROUTING_API_TYPE` | Type d'API externe : `trimble`, `here`, `generic` | — |
| `ROUTING_API_URL` | URL API de routage externe | — |
| `ROUTING_API_KEY` | Clé API de routage externe | — |

### Optimisation VRP

| Variable | Description | Défaut |
|----------|-------------|--------|
| `VRP_USE_THREADS` | Activer les worker_threads pour le VRP | — |
| `VRP_THREAD_CONCURRENCY` | Nombre de threads VRP | `4` |
| `VRP_THREAD_TIMEOUT_MS` | Timeout par thread VRP (ms) | `120000` |
| `VRP_CONCURRENCY` | Concurrence du worker BullMQ VRP | `1` |

### Intégrations externes

| Variable | Description |
|----------|-------------|
| `NESSY_API_URL` | URL de base de l'API Nessy ERP |
| `NESSY_API_KEY` | Clé API Nessy (appels sortants) |
| `NESSY_WEBHOOK_SECRET` | Secret HMAC-SHA256 pour valider les webhooks Nessy entrants |
| `OBD_WEBHOOK_TOKEN` | Token Bearer pour les webhooks télématiques OBD |
| `TRIMBLE_API_URL` | URL de base de l'API Trimble Maps |
| `TRIMBLE_API_KEY` | Clé API Trimble Maps |

### Sécurité

| Variable | Description | Défaut |
|----------|-------------|--------|
| `FORCE_HTTPS` | `false` pour désactiver HSTS | activé |
| `AI_CALLBACK_SECRET` | Secret HMAC pour le webhook AI Engine → VPS | — |
| `METRICS_TOKEN` | Token d'authentification pour `/api/metrics` | — |

### Monitoring et observabilité

| Variable | Description |
|----------|-------------|
| `SENTRY_DSN` | DSN Sentry (côté serveur) |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN Sentry (côté client) |
| `SENTRY_AUTH_TOKEN` | Token Sentry pour l'upload des source maps en CI |
| `DEBUG_LOGS` | Activer les logs de debug en production (`true`) |

### SSE et temps réel

| Variable | Description | Défaut |
|----------|-------------|--------|
| `SSE_MAX_CONNECTIONS_PER_TENANT` | Nombre max de connexions SSE par tenant | `50` |

### Load shedding

| Variable | Description | Défaut |
|----------|-------------|--------|
| `LOAD_NORMAL_THRESHOLD` | Seuil de charge normal | `50` |
| `LOAD_MAX_CONCURRENT` | Nombre max de requêtes concurrentes | `200` |
| `LOAD_THROTTLE_MS` | Délai de throttle en surcharge (ms) | `100` |

---

## Testing

### Running E2E Tests

E2E tests require a running PostgreSQL instance and a seeded test database.

Setup:
```bash
# 1. Start PostgreSQL and Redis
docker-compose -f docker-compose.local.yml up postgres redis -d

# 2. Set test environment
cp .env.example .env.test
# Edit .env.test: set DATABASE_URL to your test DB, USE_MOCK_DATA=false

# 3. Seed test data
NODE_ENV=test npx prisma migrate dev
NODE_ENV=test npm run db:seed

# 4. Run E2E tests
npm run test:e2e

# 5. View report
npx playwright show-report
```

Required env vars for E2E:
- DATABASE_URL (test database, separate from production)
- SESSION_SECRET (any 32+ char string)
- E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (seeded admin account)
- USE_MOCK_DATA=false

---

## Documentation

| Fichier | Contenu |
|---------|---------|
| [docs/ALGORITHM.md](docs/ALGORITHM.md) | Moteur VRP MV-ALNS v6 + système ML (phases 1-2-3) |
| [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | Infrastructure et déploiement 100 % cloud (dimensionnement, Docker, runbook opérationnel) |
| [docs/AI_ROADMAP.md](docs/AI_ROADMAP.md) | Modules IA : déployés vs planifiés (ML, OCR, LLM, Copilot) |

---

Logiciel propriétaire — Tous droits réservés.
