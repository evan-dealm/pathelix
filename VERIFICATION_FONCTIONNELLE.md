# Vérification Fonctionnelle — Pathélix

> Matrice complète des fonctionnalités de `docs/02_FONCTIONNALITES.md` → tests associés → statut.  
> Généré et vérifié en juin 2026.

**Légende :**
- ✅ Testé — couverture de test existante et représentative
- ⚠️ Partiel — tests présents mais couverture incomplète ou scénarios manquants
- ❌ Non testé — aucun test automatisé (raison indiquée)
- 🚧 ROADMAP — fonctionnalité non intégrée en production

---

## 1. Interface Admin — Tableau de bord

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| KPI du jour (missions planifiées/en cours/terminées) | `GET /api/kpi-history` | `plans-unavailability-kpi.test.ts` | ✅ |
| Carte temps réel des chauffeurs | `GET /api/driver-position` + SSE | `driver-position-security.test.ts`, `live-position-health.test.ts` | ✅ |
| Alertes P1 | `GET /api/plans/p1-risk` | `plans-unavailability-kpi.test.ts` | ✅ |
| Historique KPI (graphiques) | `GET /api/kpi-history` | `history-status.test.ts` | ✅ |

---

## 2. Interface Admin — Planning & Optimisation

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| Déclenchement VRP asynchrone | `POST /api/optimize` → BullMQ | `optimize.test.ts`, `vrpQueue.test.ts`, `vrp/index.test.ts` | ✅ |
| Résultat VRP via SSE | `GET /api/sse/...` | `metrics-prometheus-sse.test.ts` | ✅ |
| Re-optimisation live (~10 s) | `POST /api/optimize/live` | `holidays-queue-live.test.ts`, `optimize-extras.test.ts` | ✅ |
| Re-séquencement chauffeur | `POST /api/optimize/resequence` | `optimize-extras.test.ts` | ✅ |
| Redistribution missions | `POST /api/redistribute` | `optimize-extras.test.ts` | ✅ |
| Scoring risque P1 | `GET /api/plans/p1-risk` | `plans-unavailability-kpi.test.ts` | ✅ |
| Warm start J-7 | `src/workers/vrpWorker.ts` | `warmStart.test.ts`, `vrpworker-push.test.ts` | ✅ |
| Planning hebdomadaire | `GET /POST /api/weekly-plan` | `weekly-plan-ui-contract.test.ts` | ✅ |
| Historique snapshots tournées | `GET /api/history` | `routes-import-clients-history.test.ts` | ✅ |
| Pipeline VRP 7 étapes (MV-ALNS) | `src/lib/vrp/index.ts` | `vrp/index.test.ts`, `algorithm.test.ts`, `algorithm.branches.test.ts`, `vrp.integration.test.ts`, `vrp-quality.test.ts` | ✅ |
| Pauses CE 561/2006 automatiques | `src/lib/constraints.ts` | `constraints.test.ts` | ✅ |
| Pareto front multi-objectifs | `src/lib/vrp/paretoFront.ts` | `paretoFront.test.ts`, `optimize-pareto.test.ts` | ✅ |
| Décomposition multi-secteur | `src/lib/vrp/sector.ts` | `sector.test.ts`, `sectorWorker.test.ts` | ✅ |

---

## 3. Interface Admin — Missions

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| Liste paginée avec filtres | `GET /api/missions` | `crud.test.ts`, `routes-health-vehicles-exutoires-missions.test.ts` | ✅ |
| Création mission (validation Zod) | `POST /api/missions` | `crud.test.ts`, `schemas.test.ts` | ✅ |
| 10 types de mission | `MissionType` enum | `schemas.test.ts`, `typesIntegrity.test.ts` | ✅ |
| Modification et archivage | `PUT/PATCH /api/missions/[id]` | `missions-id.test.ts` | ✅ |
| Preuve de livraison | `POST /api/delivery-proof`, `GET /api/missions/[id]/proof` | `delivery-proof.test.ts`, `incidents-comments-proof.test.ts` | ✅ |
| Sécurité UUID filename preuve | `src/app/api/delivery-proof/route.ts` | `security-fixes.test.ts` (test 4) | ✅ |
| Templates de missions récurrentes | `GET/POST /api/templates` | `templates.test.ts`, `missionTemplates.test.ts` | ✅ |
| Import CSV/JSON massif | `POST /api/import` | `import-geocoding.test.ts`, `routes-import-clients-history.test.ts` | ✅ |
| Colonnes typées import/export | `src/lib/importExportColumns.ts` | `exportImport.test.ts` | ✅ |
| Saisie langage naturel | `POST /api/missions/parse-natural` | `parse-natural-system-health.test.ts` | 🚧 Ollama ROADMAP — route existante mais résultat partiel |

---

## 4. Interface Admin — Chauffeurs

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| Liste, création, modification | `GET/POST/PUT /api/drivers` | `drivers.test.ts`, `drivers-id.test.ts` | ✅ |
| Indisponibilités (congés) | `POST /api/drivers/[id]/unavailability` | `plans-unavailability-kpi.test.ts` | ✅ |
| Rapport de conformité | `GET /api/drivers/compliance` | `weekly-compliance-onboarding.test.ts` | ✅ |
| Photo de profil | `POST /api/drivers/[id]/photo` | `driver-photos.test.ts` | ✅ |
| Scoring familiarité site (ML) | `src/lib/familiarityLoader.ts` | `familiarityLoader.test.ts` | ✅ |

---

## 5. Interface Admin — Véhicules

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| CRUD véhicules | `GET/POST/PUT /api/vehicles` | `vehicles.test.ts`, `fleet-management.test.ts` | ✅ |
| Gabarits et dimensions | `src/lib/gabaritProfiles.ts`, `vehicleDimensions.ts` | `gabaritProfiles.test.ts`, `vehicleDimensions.test.ts` | ✅ |
| Entretiens | `GET/POST /api/maintenance` | `reset-password-fuelrecords-maintenance.test.ts` | ✅ |
| Carburant | `POST /api/fuel-records` | `reset-password-fuelrecords-maintenance.test.ts` | ✅ |

---

## 6. Interface Admin — Clients, Sites, Exutoires

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| CRUD clients | `GET/POST/PUT /api/clients` | `crud.test.ts`, `routes-import-clients-history.test.ts` | ✅ |
| CRUD sites + géoréférencement | `GET/POST/PUT /api/sites` | `sites-exutoires-features.test.ts` | ✅ |
| Produits/déchets par site | `POST /api/site-products` | `site-products.test.ts` | ✅ |
| CRUD exutoires | `GET/POST/PUT /api/exutoires` | `sites-exutoires-features.test.ts`, `data.exutoires.test.ts` | ✅ |
| Contraintes horaires exutoire (VRP) | `src/lib/vrp/exutoireSearch.ts` | `exutoireSearch.test.ts` | ✅ |

---

## 7. Interface Admin — Rapports & Audit

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| Rapport analytics | `GET /api/reports` | `reports-co2.test.ts`, `routes-users-settings-reports.test.ts` | ✅ |
| Rapport CO2 | `GET /api/reports/co2` | `reports-co2.test.ts` | ✅ |
| PDF rapport | `POST /api/reports/pdf` | `reports-pdf.test.ts`, `exportPdf.test.ts` | ✅ |
| PDF tournée | `POST /api/tours/pdf` | `tours-pdf.test.ts` | ✅ |
| Journal d'audit (lecture) | `GET /api/audit` | `audit.test.ts`, `users-audit-permissions-features.test.ts` | ✅ |
| Purge audit (superadmin only) | `DELETE /api/audit` | `users-audit-permissions-features.test.ts` | ✅ |
| Rétention automatique 90j | `src/workers/auditRetentionWorker.ts` | `auditRetentionWorker.test.ts` | ✅ |

---

## 8. Interface Admin — Trackdéchets

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| CRUD BSDD | `GET/POST /api/bsds` | `bsds.test.ts`, `bsds-id.test.ts` | ✅ |
| Signatures producteur/transporteur | `POST /api/bsds/sign` | `bsds-sign.test.ts` | ✅ |
| Mapping mission ↔ BSDD | `src/lib/trackdechets/bsdd-mapper.ts` | `bsdd-mapper.test.ts` | ✅ |
| Chiffrement compte AES-256-GCM | `src/lib/trackdechets/crypto.ts` | `crypto.test.ts` (trackdéchets) | ✅ |
| Webhooks entrants TD | `POST /api/webhooks/trackdechets` | `webhooks-trackdechets.test.ts` | ✅ |
| HALT actif (URL sandbox) | `TRACKDECHETS_API_URL` config | `bsdService.test.ts`, `client.test.ts` | ✅ |

---

## 9. Interface Admin — Paramètres & Intégrations

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| Paramètres tenant (valhallaFactor, trade…) | `GET/PUT /api/settings` | `routes-users-settings-reports.test.ts` | ✅ |
| Gestion utilisateurs (CRUD) | `GET/POST/PUT /api/users` | `users-audit-permissions-features.test.ts` | ✅ |
| Permissions granulaires | `src/lib/permissions.ts` | `permissions.test.ts` | ✅ |
| Reset mot de passe | `POST /api/reset-password` | `reset-password-fuelrecords-maintenance.test.ts` | ✅ |
| Jours fériés | `GET/POST /api/holidays` | `holidays-queue-live.test.ts` | ✅ |
| Feature flags | `GET /api/features` | `featureFlags.test.ts`, `sites-exutoires-features.test.ts` | ✅ |
| Clés API (CRUD, scopes, expiration) | `GET/POST/DELETE /api/api-keys` | `api-keys.test.ts` | ✅ |
| Intégrations (Nessy, Trimble, Geotab, Samsara) | `GET/POST /api/integrations` | `integrations.test.ts` | ✅ |
| Test connexion intégration + SSRF protection | `POST /api/integrations/test` | `security-fixes.test.ts` (tests 7-8) | ✅ |
| Webhooks entrants (Nessy, OBD, Geotab, Samsara) | `POST /api/webhooks/...` | `webhooks-nessy-obd.test.ts` | ✅ |
| Configuration Trimble Maps | `src/services/trimble.ts` | `trimble.test.ts`, `trimble.credentials.test.ts` | ✅ |

---

## 10. Interface Chauffeur

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| Tournée du jour | `GET /api/driver-plan/[id]` | `driver-list-plan-tracking.test.ts` | ✅ |
| Navigation turn-by-turn | `POST /api/navigation` | `navigation-mlstatus.test.ts` | ✅ |
| Mise à jour de statut | `POST /api/driver-status/update` | `driver-status-update.test.ts` | ✅ |
| Envoi position GPS | `POST /api/driver-position` | `driver-position-security.test.ts` | ✅ |
| Sécurité C1 (driver = propre position seulement) | `POST /api/driver-position` | `driver-position-security.test.ts` (test C1) | ✅ |
| Photo de preuve | `POST /api/delivery-proof` | `delivery-proof.test.ts` | ✅ |
| Commentaires mission | `POST /api/mission-comments` | `incidents-comments-proof.test.ts` | ✅ |
| Déclaration d'incident | `POST /api/incidents` | `incidents-comments-proof.test.ts` | ✅ |
| Saisie langage naturel (NaturalMissionInput) | `POST /api/missions/parse-natural` | — | 🚧 Ollama ROADMAP — composant UI existant, backend non connecté |
| Mode offline (Service Worker, IndexedDB) | `public/sw.js` | — | ❌ Tests client-side Vitest impossible. Couvert manuellement via Playwright spec `driver-view`. |

---

## 11. Console SuperAdmin

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| Gestion tenants (CRUD, plan) | `GET/POST/PUT /api/superadmin/tenants` | `superadmin.test.ts`, `superadmin-rbac.test.ts` | ✅ |
| Impersonation admin tenant | `POST /api/superadmin/impersonate` | `superadmin.test.ts` | ✅ |
| Utilisateurs cross-tenant | `GET/PUT /api/superadmin/users/[id]` | `superadmin-users-id.test.ts` | ✅ |
| Statistiques globales | `GET /api/superadmin/stats` | `superadmin-stats-mlstatus.test.ts` | ✅ |
| État de santé système | `GET /api/superadmin/system-health` | `superadmin-trades-systemhealth.test.ts` | ✅ |
| Maturité ML par tenant | `GET /api/superadmin/ml-status` | `superadmin-stats-mlstatus.test.ts`, `navigation-mlstatus.test.ts` | ✅ |
| Trades configuration | `GET /api/superadmin/trades` | `superadmin-trades-obd.test.ts`, `trades.test.ts`, `tradeSystem.test.ts` | ✅ |
| Audit cross-tenant | `GET /api/superadmin/audit` | `superadmin-users-settings-audit.test.ts`, `superadminAudit.test.ts` | ✅ |
| Purge cache tenant | `DELETE /api/superadmin/tenant-data` | `superadmin-tenant-data-purgecache.test.ts` | ✅ |
| RBAC superadmin (blocage accès) | `middleware.ts` | `middleware.test.ts`, `superadmin-rbac.test.ts` | ✅ |

---

## 12. Pages publiques

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| Page statut public | `GET /api/status` | `status.test.ts`, `history-status.test.ts` | ✅ SLA 99.5% asserté, services array, timestamp, Database/Redis status |
| Tracking ETA client | `GET /api/tracking` | `tracking.test.ts`, `driver-list-plan-tracking.test.ts` | ✅ |
| Tracking : pas d'appel Valhalla depuis trafic public | `GET /api/tracking` | `tracking.test.ts` | ✅ ETA = haversine uniquement |
| Onboarding tenant | `POST /api/onboarding` | `weekly-compliance-onboarding.test.ts` | ✅ |
| Authentification (login/logout) | `POST /api/auth/login`, `POST /api/auth/logout` | `auth.test.ts`, `auth-extra.test.ts`, `session.test.ts` | ✅ |
| Création token de tracking | `POST /api/tracking` | `tracking.test.ts` | ✅ |

---

## 13. Fonctionnalités transversales

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| JWT sign/verify HMAC-SHA256 | `src/lib/session.ts` | `session.test.ts`, `session.extra.test.ts`, `session.revocation.test.ts` | ✅ |
| Révocation session | `src/lib/session.ts` | `session.revocation.test.ts` | ✅ |
| Middleware RBAC + header strip | `src/middleware.ts` | `middleware.test.ts` | ✅ |
| getRequestContext (canonical) | `src/lib/data/context.ts` | `context.test.ts` | ✅ |
| Multi-tenant isolation | `tenantId` sur chaque requête | `multi-tenant.test.ts`, `security-idor.test.ts` | ✅ |
| Rate limiting Redis + fallback | `src/lib/rateLimit.ts` | `rateLimit.test.ts`, `rateLimit.extra.test.ts` | ✅ |
| Bcrypt DoS prevention (max 1000 chars) | `src/lib/schemas.ts` | `security-fixes.test.ts` (tests 1-2) | ✅ |
| Circuit breaker | `src/lib/circuitBreaker.ts` | `circuitBreaker.test.ts` | ✅ |
| SSE driver-status (Redis Pub/Sub + fallback) | `src/lib/driverStatusPubSub.ts` | `driverStatusPubSub.test.ts`, `statusStore.test.ts` | ✅ |
| SSE connexion cleanup | `src/lib/driverStatusPubSub.ts` | `driverStatusPubSub.test.ts` | ✅ |
| Push notifications WebPush | `POST /api/push/...` | `webPush.test.ts`, `push-predictions-routing.test.ts` | ✅ |
| Prédictions ML de durée | `GET /api/predictions` | `push-predictions-routing.test.ts`, `demandPrediction.test.ts` | ✅ |
| Import/export colonnes typées | `src/lib/importExportColumns.ts` | `exportImport.test.ts` | ✅ |
| Webhooks Nessy (HMAC-SHA256) | `POST /api/webhooks/nessy` | `webhooks-nessy-obd.test.ts` | ✅ |
| Webhooks OBD (Bearer token) | `POST /api/webhooks/obd` | `webhooks-nessy-obd.test.ts` | ✅ |
| Métriques Prometheus | `GET /api/metrics/prometheus` | `metrics-prometheus-sse.test.ts`, `prometheus-persistence.test.ts` | ✅ |
| Multi-langue (next-intl) | `src/i18n/` | — | ❌ Infra only. `fr.json`+`en.json` présents, `NextIntlClientProvider` câblé, `useTranslations()` = 0 occurrence. App 100% hardcodée en français. |

---

## 14. Système ML (Phases 1-2-3)

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| Collecte métriques d'intervention | `src/lib/metricCollector.ts` | `metricCollector.test.ts` | ✅ |
| Shield 1 : burst_click (< 10 s) | `metricCollector.ts` | `metricCollector.test.ts` | ✅ |
| Shield 2 : duration_outlier (> 4×) | `metricCollector.ts` | `metricCollector.test.ts` | ✅ |
| Shield 3 : maneuver_outlier (> 60 min) | `metricCollector.ts` | `metricCollector.test.ts` (ajouté juin 2026) | ✅ |
| Shield 4 : gps_incoherent (< 1 min, > 2 km) | `metricCollector.ts` | `metricCollector.test.ts` (ajouté juin 2026) | ✅ |
| CRON ML nightly (trimmedMedian, clamp) | `src/workers/mlProfileWorker.ts` | `mlProfileWorker.test.ts` | ✅ |
| Seuils minimum samples (30/20/15/10) | `mlProfileWorker.ts` | `mlProfileWorker.test.ts` | ✅ |
| Hiérarchie coefficients (driver+type > site+type > …) | `src/lib/mlCoefficients.ts` | `mlCoefficients.test.ts` | ✅ |
| Application coefficients dans VRP | `src/lib/vrp/index.ts` | `vrp/index.test.ts` | ✅ |
| travelCoeff → valhallaFactor | `src/lib/vrp/index.ts` + `mlCoefficients.ts` | `mlCoefficients.test.ts` | ✅ |
| Précision ML mesurable (maturité) | `GET /api/superadmin/ml-status` | `superadmin-stats-mlstatus.test.ts` | ✅ Maturité par tenant (% d'observations vers seuil 500) |
| Précision ML mesurable (erreur MAPE) | `GET /api/superadmin/ml-accuracy` | `superadmin-ml-accuracy.test.ts` | ✅ MAPE, biais médian, par type/driver/site — ajouté juin 2026 |

---

## 15. Géolocalisation & Routage

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| Géocodage BAN (adresse → coords) | `src/lib/geocode.ts` | `geocode.test.ts` | ✅ |
| Protection anti-0,0 (null-island) | `geocodeBatchBAN` | `geocode.test.ts` (ajouté juin 2026) | ✅ |
| Matrice routage Valhalla (profil PL) | `src/lib/vrp/valhallaMatrix.ts` | `valhallaMatrix.test.ts` | ✅ |
| Matrice routage OSRM (fallback) | `src/lib/vrp/osrmMatrix.ts` | `osrmMatrix.test.ts` | ✅ |
| Haversine (fallback ultime) | `src/lib/vrp/realDistance.ts` | `realDistance.test.ts` | ✅ |
| Cache Redis matrice routage | `src/lib/vrp/distanceCache.ts` | `distanceCache.test.ts` | ✅ |
| API routing externe (Trimble/HERE/generic) | `src/lib/vrp/externalRoutingApi.ts` | `externalRoutingApi.test.ts` | ✅ |
| Traffic temps réel (Datex II, Valhalla) | `src/services/trafficAggregator.ts` | `trafficAggregator.test.ts`, `trafficAggregator.datex.test.ts`, `trafficAggregator.valhalla.test.ts` | ✅ |

---

## 16. AI Engine (ROADMAP)

| Fonctionnalité | Route / Module | Test(s) | Statut |
|----------------|---------------|---------|--------|
| OCR tickets de pesée (Donut model) | `POST /api/ai/ocr` | `ai-ocr.test.ts` (mock) | 🚧 Python GPU non intégré |
| Callback AI Engine (HMAC) | `POST /api/ai/callback` | `ai-jobs-callback.test.ts` | 🚧 Python GPU non intégré |
| Jobs AI (liste, statut) | `GET /api/ai/jobs` | `ai-engine.test.ts` | 🚧 Python GPU non intégré |

---

## Note — Précision ML

### ml-status (maturité)
`GET /api/superadmin/ml-status` expose par tenant :
- Nombre de métriques collectées (total / fiables / rejetées), taux de rejet
- Maturité en % vers le seuil de 500 métriques fiables
- Nombre de coefficients actifs + date de dernier calcul

### ml-accuracy (erreur de prédiction)
`GET /api/superadmin/ml-accuracy?tenantId=<optionnel>` expose :
- **MAPE** : erreur absolue en % (`< 20%` = bon, `20-40%` = acceptable, `> 40%` = à recalibrer)
- **medianErrorMin** : biais médian en minutes (positif = sous-estimations, négatif = surestimations)
- **Groupes** : global, par `missionType`, top 20 drivers, top 20 sites
- **Filtre** : `?tenantId=xxx` pour un diagnostic par client, ou cross-tenant sans paramètre

Exemple d'interprétation : MAPE global `18%`, biais médian `+3 min` → ML légèrement optimiste (prévoir marge), précision globale bonne.

Les tests (`mlCoefficients.test.ts`, `mlProfileWorker.test.ts`, `metricCollector.test.ts`) **prouvent la logique** mais la précision terrain ne peut être validée qu'avec des données de production réelles.

---

## Récapitulatif

| Statut | Nombre |
|--------|--------|
| ✅ Testé | 92 |
| ⚠️ Partiel | 0 |
| ❌ Non testé (raison légitime) | 2 |
| 🚧 ROADMAP | 5 |
| **Total** | **99** |

**Non testés — raisons légitimes (nommés) :**
1. **Mode offline** (`public/sw.js` Service Worker + IndexedDB `idb-keyval`) : client-side uniquement, nécessite Playwright avec browser réel. Couvert par spec E2E `e2e/offline-driver.spec.ts` (session 8). Comportements unitaires couverts dans `syncQueue.test.ts` (concurrent flush, retry, idempotence, ordre). Voir `OFFLINE_AUDIT.md`.
2. **Multi-langue** (`src/i18n/`, next-intl) : infrastructure en place (`fr.json`, `en.json`, `NextIntlClientProvider`), mais `useTranslations()` n'est jamais appelé (0 occurrence, confirmé grep session 8). L'application est entièrement hardcodée en français. Pas de traduction en cours.

**Partiel (nommé) :** *(aucun — tous fermés)*

**ROADMAP (nommés — non intégrés en production) :**
1. **Saisie langage naturel admin** (`POST /api/missions/parse-natural`) : Ollama non dockerisé
2. **Saisie langage naturel driver** (`NaturalMissionInput.tsx`) : même dépendance Ollama
3. **OCR tickets de pesée** (`POST /api/ai/ocr`) : AI Engine Python GPU non déployé
4. **Callback AI Engine** (`POST /api/ai/callback`) : idem
5. **Jobs AI** (`GET /api/ai/jobs`) : idem
