# Pathélix — Fonctionnalités

> Description exhaustive des fonctionnalités par rôle. Vérifiée contre le code source réel (juin 2026).

---

## Table des matières

1. [Interface Admin (admin / dispatcher)](#1-interface-admin-admin--dispatcher)
2. [Interface Chauffeur (driver)](#2-interface-chauffeur-driver)
3. [Console SuperAdmin](#3-console-superadmin)
4. [Pages publiques](#4-pages-publiques)
5. [Fonctionnalités transversales](#5-fonctionnalités-transversales)

---

## 1. Interface Admin (admin / dispatcher)

Point d'entrée : `/admin`. Interface desktop multi-onglets. Les onglets visibles dépendent du rôle et des permissions.

### Onglet Tableau de bord

- KPI du jour : missions planifiées, en cours, terminées, en retard
- Carte temps réel des chauffeurs (Leaflet, positions GPS)
- Alertes P1 et incidents actifs
- Historique des KPI (graphiques, via `/api/kpi-history`)

### Onglet Planning & Optimisation

- Sélecteur de date et vue de la tournée journalière
- **Déclenchement de l'optimisation VRP** (`POST /api/optimize` → BullMQ asynchrone, résultat via SSE)
- Re-optimisation temps réel (`POST /api/optimize/live`, ~10s, synchrone)
- Re-séquencement d'un chauffeur (`POST /api/optimize/resequence`)
- Redistribution de missions entre chauffeurs (`POST /api/redistribute`)
- Scoring de risque P1 (`GET /api/plans/p1-risk`)
- Vue carte des tournées avec routes colorées par chauffeur
- Planning hebdomadaire (`GET/POST /api/weekly-plan`)
- Historique des snapshots de tournées (`GET /api/history`)

### Onglet Missions

- Liste paginée avec filtres : date, type, priorité, chauffeur, statut, archive
- Création de mission avec validation Zod (type, adresse géoréférencée, fenêtres horaires, priorité 1–3, durée estimée, contenance benne)
- 10 types de mission : `POSER RETIRER ECHANGER VIDER PAUSE CHARGER_IMMEDIAT DEPLACER TASSER EXPEDIER ALLER_RETOUR`
- Modification et archivage
- Preuve de livraison (photo/signature, `GET /api/missions/[id]/proof`)
- **Saisie en langage naturel** (`POST /api/missions/parse-natural` → Ollama local, statut partiel — voir `docs/AI_ROADMAP.md`)
- Templates de missions récurrentes (CRUD complet)
- Import massif CSV/JSON (`POST /api/import`)

### Onglet Chauffeurs

- Liste avec filtres (secteur, archive, disponibilité)
- Création/modification/archivage (profil, véhicule assigné, dépôt, compétences)
- Gestion des indisponibilités (congés, absences) avec plages de dates
- Rapport de conformité chauffeurs (`GET /api/drivers/compliance`)
- Upload/suppression de photo de profil
- Scoring de familiarité par site (historique ML)

### Onglet Véhicules

- CRUD véhicules (gabarit : poids, hauteur, largeur, longueur, capacité benne m³)
- Gestion des entretiens (historique, coûts, kilométrage)
- Enregistrements carburant (plein, coût, km parcourus)
- Archivage des véhicules hors service

### Onglet Clients

- Fiche commerciale complète (raison sociale, SIRET, contrat, contact)
- Historique des missions par client
- Archivage

### Onglet Sites

- Sites géoréférencés (adresse, coordonnées GPS, horaires d'accès)
- Produits/déchets par site (type, contenance benne, durée estimée, exutoire par défaut)
- Archivage

### Onglet Exutoires

- CRUD exutoires (déchetteries, centres de tri, quais)
- Horaires d'ouverture (contrainte respectée par le VRP)
- Types de déchets acceptés
- Lien sur les missions via `linkedExutoireId`

### Onglet Rapports

- Rapport analytics multi-dimensionnel (`GET /api/reports`)
- Rapport CO2 (`GET /api/reports/co2`) : émissions estimées par tournée et par chauffeur
- Génération PDF de rapport (`POST /api/reports/pdf`)
- PDF tournée (`POST /api/tours/pdf`)

### Onglet Catalogue

- Bibliothèque de templates de missions réutilisables
- Missions récurrentes avec fréquence configurable

### Onglet Suivi en temps réel

- Tableau des statuts chauffeurs (SSE, `/api/sse/driver-status`)
- Positions GPS en direct (`GET /api/driver-position`)
- ETA dynamique avec polling 30s (`GET /api/tracking`)
- Flux d'incidents (`GET /api/sse/incidents`)

### Onglet Prédictions ML

- Prédictions de durée d'intervention par mission (`GET /api/predictions`)
- Scoring de retard prédit (`GET /api/predictions/delay`)
- Métriques d'intervention collectées (`GET /api/metrics`)

### Onglet Intégrations

- Configuration des intégrations : Nessy (ERP), Trimble Maps, Geotab, Samsara
- Test de connexion intégration (`POST /api/integrations/test`)
- Clés API tenant (CRUD, scopes granulaires, expiration)
- Webhooks entrants configurés (Nessy, OBD, Geotab, Samsara)

### Onglet Paramètres

- Paramètres tenant : trade (secteur), valhallaFactor, pondérations VRP, langue
- Gestion des utilisateurs (CRUD, permissions granulaires, reset mot de passe)
- Jours fériés (liste personnalisée, impact planning)
- Feature flags tenant (`GET /api/features`)
- Abonnements push (`POST /api/push/subscribe`)

### Onglet Audit

- Journal d'audit complet (toutes les actions, par utilisateur, par ressource)
- Filtres date/type/utilisateur
- Purge manuelle (`DELETE /api/audit`, réservé superadmin + CRON rétention 90j)

### Onglet Trackdéchets

- Gestion des BSDD (Bordereaux de Suivi des Déchets Dangereux)
- Création, consultation, signatures producteur/transporteur
- Liaison mission ↔ BSDD
- Compte Trackdéchets chiffré AES-256-GCM
- **HALT actif** : aucun appel API TD en production sans validation manuelle (voir `VALIDATION_TRACKDECHETS.md`)

---

## 2. Interface Chauffeur (driver)

Point d'entrée : `/driver/[id]`. Interface mobile-first, optimisée tactile. Accès via JWT avec `role=driver`.

### Tournée du jour

- Liste ordonnée des missions du jour (`GET /api/driver-plan/[id]`)
- Barre de progression (missions terminées / total)
- Estimation horaire de chaque étape (`precomputedTravelMin`)
- Mission P1 mise en évidence

### Navigation

- Itinéraire turn-by-turn vers la prochaine mission (`POST /api/navigation`)
- ETA mis à jour dynamiquement
- Intégration Leaflet (carte interactive)

### Mise à jour de statut

- Boutons tactiles : Démarrer → Arriver → Commencer travail → Terminer
- Chaque transition : POST `/api/driver-status/update`
- Positions GPS envoyées périodiquement (`POST /api/driver-position`)

### Photo de preuve

- Capture photo ou signature sur écran tactile (`POST /api/delivery-proof`)
- Preuve horodatée et géolocalisée

### Commentaires

- Ajout de commentaire texte sur une mission (`POST /api/mission-comments`)
- Consultation des commentaires précédents

### Incidents

- Déclaration d'incident (panne, accident, problème accès) (`POST /api/incidents`)

### Saisie de mission en langage naturel

- Composant `NaturalMissionInput.tsx` (statut partiel — Ollama requis)

### Mode offline

- Service Worker (`public/sw.js`) : mise en cache des assets
- IndexedDB (idb-keyval) : stockage local des données de tournée
- Resync automatique au retour de connectivité

---

## 3. Console SuperAdmin

Point d'entrée : `/superadmin`. Accès exclusif `role=superadmin`. 5 onglets.

### Onglet Tenants

- Liste de tous les tenants (`GET /api/superadmin/tenants`)
- Création de tenant (`POST /api/superadmin/tenants`)
- Modification : plan tarifaire, trade, paramètres
- Impersonation : prendre l'identité d'un admin tenant (session `sub=sa:<id>`)

### Onglet Utilisateurs

- Vue cross-tenant de tous les utilisateurs
- Recherche, filtres, reset mot de passe forcé

### Onglet Métiers (Trades)

- Vue des 6 trades configurés
- Configuration par trade (labels UI personnalisés)

### Onglet Télémétrie

- Statistiques globales cross-tenant (`GET /api/superadmin/stats`)
- Volume de missions, chauffeurs actifs, jobs VRP
- État de santé global (`GET /api/superadmin/system-health`)
- Maturité ML par tenant (`GET /api/superadmin/ml-status`)

### Onglet Audit

- Journal d'audit cross-tenant
- Accès en lecture seule à toutes les actions de tous les tenants

---

## 4. Pages publiques

| URL | Description |
|-----|-------------|
| `/` | Page d'accueil marketing |
| `/login` | Formulaire de connexion |
| `/onboarding` | Assistant de création de compte tenant |
| `/help` | Documentation utilisateur + FAQ |
| `/status` | Page de statut publique (SLA 99,9%) |
| `/api-docs` | Documentation API Swagger UI (authentifié) |
| `/tracking` | ETA dynamique pour les clients finaux (lien partagé) |

---

## 5. Fonctionnalités transversales

### Notifications push

- Abonnement WebPush (`POST /api/push/subscribe`)
- Notifications pour missions P1, retards, incidents (`POST /api/push/notify`)
- VAPID keys configurées dans les variables d'environnement

### Temps réel (SSE)

- `/api/sse/driver-status` : statuts et positions de tous les chauffeurs du tenant
- `/api/sse/incidents` : incidents déclarés en temps réel
- Backend : Redis Pub/Sub (canal `driver-status:<tenantId>`) avec fallback in-memory
- Limite : 50 connexions SSE simultanées par tenant (`SSE_MAX_CONNECTIONS_PER_TENANT`)

### Sécurité

- Tous les tokens en cookies HttpOnly SameSite=strict
- CSRF implicitement empêché par SameSite=strict
- Rate limiting Redis (sliding window, fallback in-memory)
- CSP, HSTS, X-Frame-Options dans `next.config.mjs`
- Audit log automatique sur toutes les actions sensibles

### Multi-langue

- Internationalisation via next-intl 4
- Langue par défaut : français
- Infrastructure de traduction en place (`src/i18n/`)

### Import / Export

- Import CSV/JSON massif (`POST /api/import`) : missions, clients, sites, chauffeurs, véhicules
- Export de données via les endpoints de rapport
- Colonnes typées (`src/lib/importExportColumns.ts`, 7 interfaces)
