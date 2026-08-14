# Pathélix — Fonctionnalités

> Description des fonctionnalités par rôle. Vérifiée contre le code source réel (août 2026).
> Vue d'ensemble produit et architecture : [README.md](README.md). Détails techniques/sécurité : [TECHNICAL.md](TECHNICAL.md). Routes API : [API.md](API.md).

---

## 1. Interface Admin (admin / dispatcher)

Point d'entrée : `/admin`. Interface desktop multi-onglets. Les onglets visibles dépendent du rôle et des permissions granulaires (voir TECHNICAL.md).

### Tableau de bord

- KPI du jour : missions planifiées, en cours, terminées, en retard, non assignées
- Carte temps réel des chauffeurs (Leaflet, positions GPS)
- Alertes P1, chauffeurs sans tournée, GPS manquant, violations réglementaires
- Vue calendrier semaine/mois avec pool de missions

### Planning & Optimisation

- Sélecteur de date, vue de la tournée journalière et planning hebdomadaire
- **Déclenchement de l'optimisation VRP** (`POST /api/optimize` → BullMQ asynchrone, résultat via SSE)
- Re-optimisation temps réel (`POST /api/optimize/live`, ~10s, synchrone)
- Re-séquencement d'un chauffeur (`POST /api/optimize/resequence`)
- Redistribution de missions entre chauffeurs (`POST /api/redistribute`)
- Scoring de risque P1 (`GET /api/plans/p1-risk`)
- Vue carte des tournées, vue Gantt, export PDF/CSV
- Historique des snapshots de tournées

### Missions

- Liste paginée avec filtres : date, type, priorité, chauffeur, statut, archive
- Vue Tableau et vue Kanban
- Création avec validation Zod (type, adresse géoréférencée, fenêtres horaires, priorité 1–3, durée estimée, contenance benne)
- 10 types de mission : `POSER RETIRER ECHANGER VIDER PAUSE CHARGER_IMMEDIAT DEPLACER TASSER EXPEDIER ALLER_RETOUR` — `VIDER`/`PAUSE` sont synthétiques (générées par le VRP, jamais créées par un utilisateur, exclues de cette liste)
- Modification, archivage, restauration, sélection/actions groupées (archivage, suppression)
- Preuve de livraison (photo/signature)
- Templates de missions récurrentes (onglet "Récurrentes", CRUD complet, génération automatique via `recurringMissionsWorker`)
- Import massif CSV/JSON, export CSV/Excel

### Chauffeurs

- Liste avec filtres (secteur, dépôt, archive, disponibilité), recherche debouncée
- Création/modification/archivage/restauration (profil, véhicule assigné, dépôt, compétences)
- Gestion des indisponibilités (congés, absences) avec plages de dates
- Rapport de conformité chauffeurs (heures travaillées, pauses)
- Upload/suppression de photo de profil
- Barre d'heures hebdomadaires avec code couleur (vert/orange/rouge)
- Sélection groupée : marquer disponible/indisponible, archiver

### Véhicules

- CRUD (gabarit : poids, hauteur, largeur, longueur, capacité benne m³)
- Gestion des entretiens (historique, coûts, kilométrage)
- Enregistrements carburant (plein, coût, km parcourus)
- Archivage des véhicules hors service

### Clients & Sites (Catalogue)

- Fiche client (raison sociale, SIRET, contrat, contact), historique des missions, indicateurs VIP/BSD
- Sites géoréférencés (adresse, coordonnées GPS, horaires d'accès)
- Produits/déchets par site (type, contenance benne, durée estimée, exutoire par défaut)

### Exutoires

- CRUD (déchetteries, centres de tri, quais)
- Horaires d'ouverture (contrainte respectée par le VRP)
- Types de déchets acceptés
- Lien direct sur les missions via `linkedExutoireId` (pas via le client)

### Statistiques / Rapports

- Rapport analytics multi-dimensionnel
- Rapport CO2 : émissions estimées par tournée et par chauffeur
- Génération PDF de rapport et de tournée

### Historique

- Snapshots de tournées passées, navigation par date

### Suivi en temps réel

- Tableau des statuts chauffeurs (SSE)
- Positions GPS en direct
- ETA dynamique avec polling
- Flux d'incidents en direct

### Utilisateurs

- CRUD utilisateurs du tenant, rôles (`ADMIN`/`DISPATCHER`/`DRIVER`)
- **Permissions granulaires par utilisateur** (11 permissions, panneau dédié dans la modale d'édition — voir TECHNICAL.md pour le détail du modèle et ses limites actuelles)
- Réinitialisation de mot de passe

### Intégrations

- Configuration : Nessy (ERP), OBD générique, Geotab, Samsara, Trimble Maps, HERE
- Secret/token **par tenant**, jamais une variable d'environnement globale (voir API.md)
- Test de connexion intégration
- Clés API tenant (CRUD, scopes granulaires, expiration)

### Paramètres

- Paramètres tenant : trade (secteur), `valhallaFactor`, pondérations VRP
- Jours fériés (liste personnalisée, impact planning)
- Feature flags tenant
- Export/import JSON de sauvegarde (drivers, missions, plans, speeds, unavailable, lockedPlans)

### Audit

- Journal d'audit complet (créations/modifications/suppressions sur les ressources sensibles : utilisateurs, permissions, intégrations, chauffeurs, missions, véhicules), filtrable par date/type/utilisateur
- Purge manuelle réservée superadmin + CRON de rétention 90 jours

### Trackdéchets

- Gestion des BSDD (Bordereaux de Suivi des Déchets Dangereux)
- Création, consultation, signatures producteur/transporteur
- Liaison mission ↔ BSDD
- Compte Trackdéchets chiffré AES-256-GCM
- **HALT actif** : aucun appel API TD en production sans validation manuelle complète — procédure dans OPERATIONS.md

---

## 2. Interface Chauffeur (driver)

Point d'entrée : `/driver/[id]`. Interface mobile-first, optimisée tactile. Accès via JWT avec `role=driver`.

### Tournée du jour

- Liste ordonnée des missions du jour, barre de progression
- Estimation horaire de chaque étape
- Mission P1 mise en évidence
- Étape de scan ticket après une mission `VIDER` (voir TECHNICAL.md, module OCR partiel)

### Navigation

- Itinéraire turn-by-turn vers la prochaine mission
- ETA mis à jour dynamiquement
- Carte interactive Leaflet

### Mise à jour de statut

- Boutons tactiles : Démarrer → Arriver → Commencer travail → Terminer
- Positions GPS envoyées périodiquement

### Photo de preuve

- Capture photo ou signature sur écran tactile, horodatée et géolocalisée

### Commentaires & Incidents

- Commentaire texte sur une mission
- Déclaration d'incident (panne, accident, problème d'accès)

### Saisie de mission en langage naturel

- Composant `NaturalMissionInput.tsx` — appelle `POST /api/missions/parse-natural` (Ollama local)
- Fonctionnel uniquement si un serveur Ollama est joignable ; pas de repli si absent (erreur explicite)

### Mode offline

- Service Worker (`public/sw.js`) : mise en cache des assets
- IndexedDB (`idb-keyval`) : stockage local des données de tournée
- Resync automatique au retour de connectivité (verrou anti-double-flush entre page et Service Worker)

---

## 3. Console SuperAdmin

Point d'entrée : `/superadmin`. Accès exclusif `role=superadmin`.

### Tenants

- Liste de tous les tenants, création, modification (plan tarifaire, trade, paramètres)
- Suspension/activation, purge de cache
- Impersonation : prendre l'identité d'un admin tenant (session `sub=sa:<id>`, journalisée)

### Utilisateurs

- Vue cross-tenant de tous les utilisateurs, recherche, filtres, reset mot de passe forcé

### Métiers (Trades)

- Vue des trades configurés (6 intégrés + trades personnalisés créés par un superadmin)
- Configuration des labels UI par trade personnalisé

### Télémétrie

- Statistiques globales cross-tenant, volume de missions, chauffeurs actifs, jobs VRP
- État de santé global, maturité ML par tenant

### Audit

- Journal d'audit cross-tenant, lecture seule

---

## 4. Pages publiques

| URL | Description |
|-----|-------------|
| `/` | Page d'accueil marketing |
| `/login` | Formulaire de connexion |
| `/onboarding` | Assistant de création de compte tenant |
| `/help` | Documentation utilisateur + FAQ |
| `/status` | Page de statut publique |
| `/api-docs` | Documentation API Swagger UI (authentifié) |
| `/track/[token]` | Suivi de mission pour un client final (lien à durée limitée) |

---

## 5. Fonctionnalités transversales

### Notifications push

- Abonnement WebPush, notifications pour missions P1, retards, incidents
- Clés VAPID configurées en variables d'environnement

### Temps réel (SSE)

- Statuts et positions chauffeurs, incidents en temps réel
- Backend : Redis Pub/Sub avec fallback in-memory/polling si Redis absent
- Limite : 200 connexions SSE simultanées par tenant par défaut (`SSE_MAX_CONNECTIONS_PER_TENANT`, relevée depuis 50 lors du dimensionnement à 150 chauffeurs — voir OPERATIONS.md)

### Sécurité

- Tous les tokens en cookies HttpOnly `SameSite=Strict`
- Rate limiting Redis (sliding window, fallback in-memory)
- CSP, HSTS, `X-Frame-Options` dans `next.config.mjs`
- Audit log sur les mutations sensibles (utilisateurs, rôles, permissions, intégrations)
- Détail complet : TECHNICAL.md

### Multi-langue

> **Non disponible au lancement France — infrastructure non câblée.**

- Infrastructure `next-intl` 4 installée (`fr.json`, `en.json`, `NextIntlClientProvider` configuré)
- `useTranslations()` non utilisé dans l'application — 100% hardcodé en français
- Aucune interface de sélection de langue exposée à l'utilisateur
- Câblage prévu pour une version ultérieure, hors scope pilote

### Import / Export

- Import CSV/JSON massif : missions, clients, sites, chauffeurs, véhicules
- Export via les endpoints de rapport et les vues Missions/Chauffeurs
