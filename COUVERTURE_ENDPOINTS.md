# COUVERTURE_ENDPOINTS.md

> Dernière mise à jour : 2026-06-17  
> 119 routes au total · Statut global : **∼97 % couvertes** (voir sections gap ci-dessous)

## Légende

| Symbole | Signification |
|---------|---------------|
| ✅ | Cas couvert par test unitaire ou E2E |
| ⚠️ | Couverture partielle (manque ≥ 1 cas de la matrice) |
| ❌ | Non couvert |

## Matrice de cas par endpoint

Pour chaque route, la matrice cible :
- **200/201** succès · **400** body invalide · **401** non authentifié · **403** rôle insuffisant · **404** ressource manquante · **422** validation Zod · **Isolation tenant** · **+cas spécifiques**

---

## Authentification

| Route | 200 | 400 | 401 | 403 | 422 | Isolation | Cas spécifiques | Tests |
|-------|-----|-----|-----|-----|-----|-----------|-----------------|-------|
| `POST /auth/login` | ✅ | ✅ | ✅ | — | ✅ | — | brute-force, token httpOnly | auth.test.ts, auth-login-realdb.test.ts, auth-extra.test.ts |
| `POST /auth/logout` | ✅ | — | — | — | — | — | clear cookie | auth.test.ts |
| `GET /auth/me` | ✅ | — | ✅ | — | — | — | session validée | auth-extra.test.ts |
| `POST /auth/change-password` | ✅ | ✅ | ✅ | — | ✅ | — | — | auth-extra.test.ts, change-password-resources.test.ts |

---

## Trackdéchets (nouveaux)

| Route | 200 | 400 | 401 | 403 | 404 | 422 | 502 | Isolation | Tests |
|-------|-----|-----|-----|-----|-----|-----|-----|-----------|-------|
| `GET /trackdechets/accounts` | ✅ | — | — | ✅ | — | — | — | ✅ | trackdechets-accounts.test.ts |
| `POST /trackdechets/accounts` | ✅ | ✅ | — | ✅ | — | ✅ | — | ✅ | trackdechets-accounts.test.ts |
| `DELETE /trackdechets/accounts/[id]` | ✅ | — | — | ✅ | ✅ | — | — | ✅ | trackdechets-accounts.test.ts |
| `GET /bsds` | ✅ | — | — | ✅ | — | — | — | ✅ | bsds.test.ts |
| `POST /bsds` | ✅ | ✅ | — | ✅ | — | ✅ | ✅ | ✅ | bsds.test.ts |
| `GET /bsds/[id]` | ✅ | — | — | ✅ | ✅ | — | — | ✅ | bsds.test.ts (mock) |
| `POST /bsds/[id]/sign` | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | bsds-sign.test.ts |
| `POST /webhooks/trackdechets` | ✅ | ✅ | ✅ | — | — | — | — | — | webhooks-trackdechets.test.ts |

**Cas spéciaux Trackdéchets :**
- ✅ Pré-validation avant signature producteur (wasteDetails.name + quantity)
- ✅ Pré-validation avant signature transporteur (transporter.* requis)
- ✅ Acteur non inscrit → 502 avec message clair
- ✅ HMAC webhook invalide → 401
- ✅ BSD non trouvé localement → ignoré (200 + ignored:true)
- ✅ ReadableId mis à jour si présent dans webhook

---

## Drivers & Plans

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET /drivers` | ✅ multi-tenant isolation | drivers.test.ts, multi-tenant.test.ts |
| `POST /drivers` | ✅ | drivers.test.ts |
| `GET /drivers/[id]` | ✅ IDOR | drivers-id.test.ts, security-idor.test.ts |
| `PUT /drivers/[id]` | ✅ | drivers-id.test.ts |
| `DELETE /drivers/[id]` | ✅ | drivers-id.test.ts |
| `GET /drivers/compliance` | ✅ | weekly-compliance-onboarding.test.ts |
| `GET /driver-list` | ✅ | driver-list-plan-tracking.test.ts |
| `GET /driver-plan/[id]` | ✅ | driver-list-plan-tracking.test.ts |
| `POST /driver-position` | ✅ | live-position-health.test.ts |
| `POST /driver-status/update` | ✅ | driver-status-update.test.ts |
| `GET /driver-unavailability` | ✅ | plans-unavailability-kpi.test.ts |
| `POST /driver-unavailability` | ✅ | plans-unavailability-kpi.test.ts |
| `DELETE /driver-unavailability/[id]` | ✅ | weekly-compliance-onboarding.test.ts |
| `POST /driver-photos` | ✅ | driver-photos.test.ts |

---

## Missions

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET /missions` | ✅ | missions-id.test.ts, multi-tenant.test.ts |
| `POST /missions` | ✅ | crud.test.ts, multi-tenant.test.ts |
| `GET /missions/[id]` | ✅ IDOR | missions-id.test.ts, security-idor.test.ts |
| `PUT /missions/[id]` | ✅ | missions-id.test.ts |
| `DELETE /missions/[id]` | ✅ | missions-id.test.ts |
| `POST /missions/[id]/proof` | ✅ | delivery-proof.test.ts, incidents-comments-proof.test.ts |
| `POST /missions/parse-natural` | ✅ | optimize-extras.test.ts, parse-natural-system-health.test.ts |
| `POST /missions/queue` | ✅ | holidays-queue-live.test.ts, optimize-extras.test.ts |

---

## Optimize / VRP

| Route | Couverture | Tests |
|-------|-----------|-------|
| `POST /optimize` | ✅ | optimize.test.ts, optimize-pareto.test.ts, vrpworker-push.test.ts |
| `GET /optimize/[jobId]` | ✅ | optimize-extras.test.ts |
| `POST /optimize/live` | ✅ | holidays-queue-live.test.ts |
| `POST /optimize/resequence` | ✅ | holidays-queue-live.test.ts, optimize-extras.test.ts |
| `GET /plans` | ✅ | plans-unavailability-kpi.test.ts |
| `GET /plans/p1-risk` | ✅ | optimize-extras.test.ts |
| `GET /weekly-plan` | ✅ | weekly-plan-ui-contract.test.ts, weekly-compliance-onboarding.test.ts |

---

## Clients / Sites / Vehicles / Exutoires

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET/POST /clients` | ✅ | routes-import-clients-history.test.ts |
| `GET/PUT/DELETE /clients/[id]` | ✅ IDOR | crud.test.ts, security-idor.test.ts |
| `GET/POST /sites` | ✅ | sites-exutoires-features.test.ts |
| `GET/PUT/DELETE /sites/[id]` | ✅ IDOR | crud.test.ts, security-idor.test.ts |
| `GET/POST /vehicles` | ✅ | routes-health-vehicles-exutoires-missions.test.ts, vehicles.test.ts |
| `PUT/DELETE /vehicles/[id]` | ✅ | routes-health-vehicles-exutoires-missions.test.ts |
| `GET/POST /exutoires` | ✅ | routes-health-vehicles-exutoires-missions.test.ts, sites-exutoires-features.test.ts |
| `GET/PUT/DELETE /exutoires/[id]` | ✅ IDOR | routes-health-vehicles-exutoires-missions.test.ts |
| `GET/POST /site-products` | ✅ | site-products.test.ts |
| `PUT/DELETE /site-products/[id]` | ✅ | site-products.test.ts |

---

## Templates / Catalogue

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET/POST /templates` | ✅ | templates.test.ts |
| `GET/PUT/DELETE /templates/[id]` | ✅ | templates.test.ts |

---

## Users / Settings / Permissions / API Keys

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET/POST /users` | ✅ | routes-users-settings-reports.test.ts |
| `GET/PUT/DELETE /users/[id]` | ✅ IDOR | sites-exutoires-features.test.ts, users-audit-permissions-features.test.ts |
| `POST /users/[id]/reset-password` | ✅ | sites-exutoires-features.test.ts, reset-password-fuelrecords-maintenance.test.ts |
| `GET/PUT /settings` | ✅ | routes-users-settings-reports.test.ts |
| `GET/PUT /permissions` | ✅ | users-audit-permissions-features.test.ts |
| `GET/POST /api-keys` | ✅ | api-keys.test.ts, users-audit-permissions-features.test.ts |
| `GET /features` | ✅ | sites-exutoires-features.test.ts, users-audit-permissions-features.test.ts |

---

## Maintenance / Fuel / Incidents / Comments

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET/POST /fuel-records` | ✅ | fleet-management.test.ts |
| `GET/PUT/DELETE /fuel-records/[id]` | ✅ IDOR | reset-password-fuelrecords-maintenance.test.ts, security-idor.test.ts, resource-delete-by-id.test.ts |
| `GET/POST /maintenance` | ✅ | fleet-management.test.ts |
| `GET/PUT/DELETE /maintenance/[id]` | ✅ IDOR | reset-password-fuelrecords-maintenance.test.ts, resource-delete-by-id.test.ts |
| `GET/POST /incidents` | ✅ | incidents-comments-proof.test.ts |
| `GET/POST /mission-comments` | ✅ | incidents-comments-proof.test.ts |
| `PUT/DELETE /mission-comments/[id]` | ✅ IDOR | resource-delete-by-id.test.ts |

---

## Holidays / Unavailability

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET/POST /holidays` | ✅ | fleet-management.test.ts, holidays-queue-live.test.ts |
| `GET/DELETE /holidays/[id]` | ✅ IDOR | resource-delete-by-id.test.ts |
| `GET/POST /driver-unavailability` | ✅ | plans-unavailability-kpi.test.ts |
| `DELETE /driver-unavailability/[id]` | ✅ | weekly-compliance-onboarding.test.ts |

---

## Reporting

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET /reports` | ✅ | routes-users-settings-reports.test.ts |
| `GET /reports/co2` | ✅ | reports-co2.test.ts, push-predictions-routing.test.ts |
| `POST /reports/pdf` | ✅ | reports-pdf.test.ts |
| `GET /tours/pdf` | ✅ | tours-pdf.test.ts |
| `GET /kpi-history` | ✅ | plans-unavailability-kpi.test.ts |
| `GET /history` | ✅ | history-status.test.ts |
| `GET /history/[id]` | ✅ IDOR | history-status.test.ts, security-idor.test.ts |

---

## AI

| Route | Couverture | Tests |
|-------|-----------|-------|
| `POST /ai/ocr` | ✅ | ai-engine.test.ts, ai-ocr.test.ts |
| `GET/POST /ai/jobs` | ✅ | ai-engine.test.ts |
| `GET /ai/jobs/[id]` | ✅ | ai-engine.test.ts, ai-jobs-callback.test.ts |
| `POST /ai/callback` | ✅ HMAC | ai-engine.test.ts |

---

## Navigation / Predictions / Routing

| Route | Couverture | Tests |
|-------|-----------|-------|
| `POST /navigation` | ✅ | navigation-mlstatus.test.ts |
| `GET /predictions` | ✅ | push-predictions-routing.test.ts, users-audit-permissions-features.test.ts |
| `GET /predictions/delay` | ✅ | weekly-compliance-onboarding.test.ts |
| `POST /routing` | ✅ | push-predictions-routing.test.ts |
| `POST /trimble/route-calc` | ✅ | trimble-route-calc.test.ts |

---

## Push / SSE

| Route | Couverture | Tests |
|-------|-----------|-------|
| `POST /push/subscribe` | ✅ | push-predictions-routing.test.ts |
| `POST /push/notify` | ✅ | push-predictions-routing.test.ts |
| `GET /sse/incidents` | ✅ | metrics-prometheus-sse.test.ts |
| `GET /sse/driver-status` | ⚠️ | mentions in security-fixes.test.ts, minimal coverage |

---

## Webhooks

| Route | Couverture | Tests |
|-------|-----------|-------|
| `POST /webhooks/nessy` | ✅ HMAC | webhooks-nessy-obd.test.ts |
| `POST /webhooks/obd` | ✅ Bearer | webhooks-nessy-obd.test.ts, superadmin-trades-obd.test.ts |
| `POST /webhooks/geotab` | ✅ | integrations.test.ts |
| `POST /webhooks/samsara` | ✅ | integrations.test.ts |
| `POST /webhooks/trackdechets` | ✅ HMAC | webhooks-trackdechets.test.ts |

---

## Superadmin

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET /superadmin/tenants` | ✅ | superadmin.test.ts |
| `POST /superadmin/tenants` | ✅ | superadmin.test.ts |
| `GET/PUT/DELETE /superadmin/tenants/[id]` | ✅ | superadmin.test.ts |
| `POST /superadmin/tenants/[id]/activate` | ✅ | superadmin.test.ts |
| `POST /superadmin/tenants/[id]/suspend` | ✅ | superadmin.test.ts |
| `POST /superadmin/impersonate` | ✅ RBAC | superadmin.test.ts, superadmin-rbac.test.ts |
| `POST /superadmin/exit-impersonation` | ✅ | superadmin-users-settings-audit.test.ts |
| `GET /superadmin/stats` | ✅ | superadmin-stats-mlstatus.test.ts |
| `GET /superadmin/ml-status` | ✅ | superadmin-stats-mlstatus.test.ts, navigation-mlstatus.test.ts |
| `GET /superadmin/system-health` | ✅ | superadmin-trades-systemhealth.test.ts, parse-natural-system-health.test.ts |
| `GET /superadmin/audit-logs` | ✅ | superadmin-users-settings-audit.test.ts |
| `GET/POST /superadmin/users` | ✅ | superadmin-users-settings-audit.test.ts |
| `GET/PUT/DELETE /superadmin/users/[id]` | ✅ | superadmin-users-id.test.ts |
| `GET/POST /superadmin/trades` | ✅ | superadmin-trades-systemhealth.test.ts |
| `PUT/DELETE /superadmin/trades/[id]` | ✅ | superadmin-trades-obd.test.ts |
| `PUT /superadmin/tenants/[id]/settings` | ✅ | superadmin-users-settings-audit.test.ts, change-password-resources.test.ts |
| `GET /superadmin/tenants/[id]/data` | ✅ | superadmin-tenant-data-purgecache.test.ts |
| `POST /superadmin/tenants/[id]/purge-cache` | ✅ | superadmin-tenant-data-purgecache.test.ts |
| `GET /superadmin/tenants/[id]/resources` | ✅ | change-password-resources.test.ts |

---

## Infrastructure

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET /health` | ✅ | routes-health-vehicles-exutoires-missions.test.ts, live-position-health.test.ts |
| `GET /ready` | ✅ | security-fixes.test.ts |
| `GET /status` | ✅ | history-status.test.ts |
| `GET /metrics` | ✅ | metrics-prometheus-sse.test.ts |
| `GET /metrics/prometheus` | ✅ | metrics-prometheus-sse.test.ts |
| `GET /docs` | ✅ | docs-benchmark.test.ts |
| `POST /benchmark` | ✅ | docs-benchmark.test.ts |

---

## Divers

| Route | Couverture | Tests |
|-------|-----------|-------|
| `GET /tracking` | ✅ | driver-list-plan-tracking.test.ts, tracking.test.ts |
| `GET/POST /import` | ✅ | routes-import-clients-history.test.ts, import-geocoding.test.ts |
| `POST /delivery-proof` | ✅ | incidents-comments-proof.test.ts, delivery-proof.test.ts |
| `POST /onboarding` | ✅ | weekly-compliance-onboarding.test.ts |
| `GET /onboarding` | ✅ | weekly-compliance-onboarding.test.ts |
| `GET /navigation` | ✅ | navigation-mlstatus.test.ts |
| `GET /integrations` | ✅ | integrations.test.ts |
| `POST /integrations/test` | ✅ | integrations.test.ts |
| `GET /audit` | ✅ | users-audit-permissions-features.test.ts |
| `GET /admin/geocoding-audit` | ✅ | geocoding-audit.test.ts |
| `POST /redistribute` | ✅ | driver-list-plan-tracking.test.ts |

---

## Gaps & Actions requises

| Route | Gap | Priorité |
|-------|-----|---------|
| `GET /sse/driver-status` | Couverture SSE minimale — stream ouvert, format événement | P2 |
| `GET /bsds/[id]` (sync=true) | Test du sync Trackdéchets côté TD API non couvert | P2 |

## Isolation tenant — preuves exhaustives

Tests dédiés à la non-fuite cross-tenant :
- `security-idor.test.ts` — 12 endpoints IDOR
- `multi-tenant.test.ts` — drivers et missions
- `security-fixes.test.ts` — checks généraux

Vérification Prisma exhaustive par `Grep` : aucune requête Prisma sans `tenantId` dans les routes non-superadmin.

## Isolation tenant Trackdéchets

- `GET /bsds` → `where: { tenantId }` ✅
- `GET /bsds/[id]` → `where: { id, tenantId }` ✅
- `POST /bsds/[id]/sign` → `bsd.findFirst({ where: { id, tenantId } })` ✅
- `DELETE /trackdechets/accounts/[id]` → vérifie `account.tenantId === tenantId` ✅
