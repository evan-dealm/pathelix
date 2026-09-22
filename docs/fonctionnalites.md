# Pathélix — Fonctionnalités

> Description des fonctionnalités par rôle. Vérifiée contre le code source réel le
> 2026-09-21. Vue d'ensemble : [../README.md](../README.md). Détails techniques/sécurité :
> [authentification-securite.md](authentification-securite.md). Routes API : [api.md](api.md).

## 1. Interface Admin (admin / dispatcher)

Point d'entrée : `/admin`. Interface desktop multi-onglets. Les onglets visibles dépendent du
rôle (gating par rôle sur la navigation) — voir
[authentification-securite.md](authentification-securite.md) pour le détail exact de ce que
les permissions granulaires contrôlent réellement versus ce qu'elles ne contrôlent pas encore.

### Tableau de bord

- KPI du jour : missions planifiées, en cours, terminées, en retard, non assignées
- Carte temps réel des chauffeurs (MapLibre GL JS, tuiles vectorielles, positions GPS)
- Alertes P1, chauffeurs sans tournée, GPS manquant, violations réglementaires
- Vue calendrier semaine/mois avec pool de missions
- Notes de planification — **limitation connue** : stockées en `localStorage` uniquement,
  jamais partagées entre dispatchers ni persistées en base (voir [tests.md](tests.md))

### Planning & Optimisation

- Sélecteur de date, vue de la tournée journalière et planning hebdomadaire
- Déclenchement de l'optimisation VRP (`POST /api/optimize` → BullMQ asynchrone, résultat via
  SSE)
- Re-optimisation temps réel (`POST /api/optimize/live`, ~10s, synchrone)
- Re-séquencement d'un chauffeur, redistribution entre chauffeurs
- Scoring de risque P1
- Vue carte des tournées, vue Gantt, export PDF/CSV — **export PDF connu cassé en production**,
  voir [tests.md](tests.md)
- Undo/Redo sur les actions de planification (corrigé le 2026-09-21 — voir
  [audit-2026-09-21.md](audit-2026-09-21.md))
- Historique des snapshots de tournées

### Missions

- Liste paginée avec filtres : date, type, priorité, chauffeur, statut, archive ; vue Tableau
  et Kanban
- 10 types de mission : `POSER RETIRER ECHANGER VIDER PAUSE CHARGER_IMMEDIAT DEPLACER TASSER
  EXPEDIER ALLER_RETOUR` — `VIDER`/`PAUSE` sont synthétiques (générées par le VRP)
- Modification, archivage, restauration, actions groupées
- Preuve de livraison (photo/signature)
- Templates de missions récurrentes (CRUD, génération automatique via
  `recurringMissionsWorker`)
- Import massif CSV/JSON, export CSV/Excel

### Chauffeurs

- Liste avec filtres (secteur, dépôt, archive, disponibilité)
- CRUD, gestion des indisponibilités, rapport de conformité, photo de profil
- Barre d'heures hebdomadaires (code couleur vert/orange/rouge)

### Véhicules

- CRUD (gabarit : poids, hauteur, largeur, longueur, capacité benne m³)
- Entretiens, carburant, archivage

### Clients & Sites (Catalogue)

- Fiche client, sites géoréférencés, produits/déchets par site

### Exutoires

- CRUD, horaires d'ouverture (contrainte respectée par le VRP), types de déchets acceptés

### Statistiques / Rapports

- Rapport analytics multi-dimensionnel, rapport CO2, génération PDF

### Historique

- Snapshots de tournées passées, navigation par date

### Suivi en temps réel

- Statuts chauffeurs (SSE), positions GPS, ETA dynamique, incidents en direct

### Utilisateurs

- CRUD, rôles (`ADMIN`/`DISPATCHER`/`DRIVER`), permissions granulaires par utilisateur (11
  permissions), réinitialisation de mot de passe

### Intégrations

- Nessy, OBD générique, Geotab, Samsara, Trimble Maps, HERE — secret/token **par tenant**
- Test de connexion, clés API tenant

### Paramètres

- Trade (secteur), `valhallaFactor`, pondérations VRP, jours fériés, feature flags
- Export/import JSON de sauvegarde (missions, plans, drivers, speeds, unavailable, lockedPlans)

### Audit

- Journal d'audit filtrable (date/type/utilisateur), pagination
- Purge manuelle réservée superadmin + CRON de rétention (365 jours par défaut)

### Trackdéchets

- Gestion des BSDD, création/consultation/signatures, liaison mission ↔ BSDD
- **HALT actif** : aucun appel API TD en production sans validation manuelle complète

## 2. Interface Chauffeur (driver)

Point d'entrée : `/driver/[id]`. Interface mobile-first, tactile. Accès via JWT `role=driver`.

- Tournée du jour, progression, ETA, mission P1 mise en évidence
- Navigation : lien externe vers Google Maps par mission (itinéraire ou recherche selon les
  coordonnées disponibles) — **pas de carte embarquée sur cette page** (correction d'une
  inexactitude documentaire antérieure qui affirmait à tort une "carte interactive Leaflet"
  ici ; vérifié contre le code le 2026-09-22, voir MIGRATION_MAPLIBRE_LOG.md)
- Statuts tactiles : Démarrer → Arriver → Commencer travail → Terminer
- Photo de preuve (capture/signature), commentaires, déclaration d'incident
- Scan ticket de pesée après une mission `VIDER`
- Saisie de mission en langage naturel (Ollama, pas de repli si indisponible)
- Mode offline : Service Worker + IndexedDB, resync automatique au retour réseau

## 3. Console SuperAdmin

Point d'entrée : `/superadmin`. Accès exclusif `role=superadmin`.

- Tenants : liste, création, modification, suspension/activation, purge de cache,
  impersonation (journalisée)
- Utilisateurs : vue cross-tenant, reset mot de passe forcé
- Métiers (Trades) : 6 intégrés + trades personnalisés
- Télémétrie : statistiques globales, maturité ML par tenant
- Audit cross-tenant en lecture seule

## 4. Pages publiques

| URL | Description |
|-----|-------------|
| `/` | Page d'accueil marketing |
| `/login` | Connexion |
| `/onboarding` | Assistant de création de compte tenant |
| `/help` | Documentation utilisateur + FAQ |
| `/status` | Page de statut publique |
| `/api-docs` | Documentation API Swagger UI (authentifié) |
| `/track/[token]` | Suivi de mission pour un client final (lien à durée limitée) |

## 5. Fonctionnalités transversales

- **Notifications push** : WebPush, VAPID, missions P1/retards/incidents
- **Temps réel (SSE)** : statuts/positions chauffeurs, incidents ; Redis Pub/Sub avec fallback
- **Sécurité** : voir [authentification-securite.md](authentification-securite.md)
- **Multi-langue** : infrastructure `next-intl` installée mais **non câblée** —
  `useTranslations()` jamais appelé, 100% hardcodé en français, aucun sélecteur de langue
- **Import/Export** : CSV/JSON massif (missions, clients, sites, chauffeurs, véhicules)
