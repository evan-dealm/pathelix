# AUDIT_TRACKING.md — Audit final avant pilote (2026-07-03)

Colonnes: Auth = getRequestContext/getTenantId/verifySession/HMAC/whitelist justifiée · Zod = validation body POST/PUT (manuel = validation typée à la main, vérifiée) · Tenant = filtre tenantId ou N/A · Test = fichier test couvrant

## Routes API (120)

| Fichier | Auth | Zod | tenantId | Perf | Test | Statut |
|---|---|---|---|---|---|---|
| `src/app/api/admin/geocoding-audit/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/ai/callback/route.ts` | ✅ HMAC/token | ✅ | N/A (HMAC, job scopé par id) | ✅ | ✅ | audité |
| `src/app/api/ai/jobs/[id]/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/ai/jobs/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/ai/ocr/route.ts` | ✅ ctx | ✅ manuel vérifié | ✅ | ✅ | ✅ | audité |
| `src/app/api/api-keys/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/audit/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/auth/change-password/route.ts` | ✅ JWT direct | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/auth/login/route.ts` | ✅ HMAC/token | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/auth/logout/route.ts` | ✅ public justifié | ✅ manuel vérifié | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/auth/me/route.ts` | ✅ ctx | N/A | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/benchmark/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/bsds/[id]/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/bsds/[id]/sign/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/bsds/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/clients/[id]/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/clients/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/delivery-proof/route.ts` | ✅ ctx | ✅ manuel vérifié | ✅ | ✅ | ✅ | audité |
| `src/app/api/docs/route.ts` | ✅ public justifié | N/A | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/driver-list/route.ts` | ✅ JWT direct | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/driver-photos/route.ts` | ✅ JWT direct | ✅ manuel vérifié | ✅ | ✅ | ✅ | audité |
| `src/app/api/driver-plan/[id]/route.ts` | ✅ JWT direct | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/driver-position/route.ts` | ✅ JWT direct | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/drivers/[id]/route.ts` | ✅ ctx | ✅ | N/A (pas de DB directe) | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/drivers/compliance/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/drivers/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/driver-status/route.ts` | ✅ JWT direct | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/driver-status/update/route.ts` | ✅ JWT direct | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/driver-unavailability/[id]/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/driver-unavailability/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/exutoires/[id]/route.ts` | ✅ ctx | ✅ | N/A (pas de DB directe) | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/exutoires/route.ts` | ✅ ctx | ✅ | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/features/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/fuel-records/[id]/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/fuel-records/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/health/route.ts` | ✅ JWT direct | N/A | N/A (global/webhook) | ✅ | ✅ | audité |
| `src/app/api/history/[id]/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/history/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/holidays/[id]/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/holidays/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/import/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/incidents/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/integrations/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/integrations/test/route.ts` | ✅ ctx | ✅ | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/kpi-history/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/maintenance/[id]/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/maintenance/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/metrics/prometheus/route.ts` | ✅ JWT direct | N/A | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/metrics/route.ts` | ✅ JWT direct | N/A | N/A (pas de DB directe) | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/mission-comments/[id]/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/mission-comments/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/missions/[id]/proof/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/missions/[id]/route.ts` | ✅ ctx | ✅ | N/A (pas de DB directe) | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/missions/parse-natural/route.ts` | ✅ ctx | ✅ | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/missions/queue/route.ts` | ✅ ctx | N/A | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/missions/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/navigation/route.ts` | ✅ JWT direct | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/onboarding/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/optimize/[jobId]/route.ts` | ✅ ctx | N/A | N/A (pas de DB directe) | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/optimize/live/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/optimize/resequence/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/optimize/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/permissions/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/plans/p1-risk/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/plans/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/predictions/delay/route.ts` | ✅ ctx | N/A | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/predictions/route.ts` | ✅ ctx | N/A | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/push/notify/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/push/subscribe/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/ready/route.ts` | ✅ public justifié | N/A | N/A (global/webhook) | ✅ | ✅ | audité |
| `src/app/api/redistribute/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/reports/co2/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/reports/pdf/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/reports/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/routing/route.ts` | ✅ ctx | ✅ | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/settings/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/site-products/[id]/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/site-products/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/sites/[id]/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/sites/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/sse/driver-status/route.ts` | ✅ ctx | N/A | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/sse/incidents/route.ts` | ✅ ctx | N/A | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/status/route.ts` | ✅ public justifié | N/A | N/A (global/webhook) | ✅ | ✅ | audité |
| `src/app/api/superadmin/audit-logs/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/superadmin/exit-impersonation/route.ts` | ✅ JWT direct | ✅ manuel vérifié | ✅ | ✅ | ✅ | audité |
| `src/app/api/superadmin/impersonate/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/superadmin/ml-accuracy/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/superadmin/ml-status/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/superadmin/stats/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/superadmin/system-health/route.ts` | ✅ ctx | N/A | N/A (global/webhook) | ✅ | ✅ | audité |
| `src/app/api/superadmin/tenants/[id]/activate/route.ts` | ✅ ctx | ✅ manuel vérifié | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/superadmin/tenants/[id]/data/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/superadmin/tenants/[id]/purge-cache/route.ts` | ✅ ctx | ✅ manuel vérifié | N/A (pas de DB directe) | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/superadmin/tenants/[id]/resources/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/superadmin/tenants/[id]/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/superadmin/tenants/[id]/settings/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/superadmin/tenants/[id]/suspend/route.ts` | ✅ ctx | ✅ manuel vérifié | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/superadmin/tenants/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/superadmin/trades/[id]/route.ts` | ✅ ctx | ✅ | N/A (global/webhook) | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/superadmin/trades/route.ts` | ✅ ctx | ✅ | N/A (global/webhook) | ✅ | ✅ | audité |
| `src/app/api/superadmin/users/[id]/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/superadmin/users/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/templates/[id]/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/templates/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/tours/pdf/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ | audité |
| `src/app/api/trackdechets/accounts/[id]/route.ts` | ✅ ctx | N/A | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/trackdechets/accounts/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/tracking/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/trimble/route-calc/route.ts` | ✅ ctx | ✅ | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/users/[id]/reset-password/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/users/[id]/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/users/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/vehicles/[id]/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ (couvert — vérifié via rapport de couverture v8, cf. §Tests) | audité |
| `src/app/api/vehicles/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/webhooks/geotab/route.ts` | ✅ HMAC/token | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/webhooks/nessy/route.ts` | ✅ HMAC/token | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/webhooks/obd/route.ts` | ✅ HMAC/token | ✅ | N/A (pas de DB directe) | ✅ | ✅ | audité |
| `src/app/api/webhooks/samsara/route.ts` | ✅ HMAC/token | ✅ | ✅ | ✅ | ✅ | audité |
| `src/app/api/webhooks/trackdechets/route.ts` | ✅ HMAC/token | ✅ | N/A (global/webhook) | ✅ | ✅ | audité |
| `src/app/api/weekly-plan/route.ts` | ✅ ctx | ✅ | ✅ | ✅ | ✅ | audité |

## Pages (11)

| Fichier | Auth (middleware) | Perf | Statut |
|---|---|---|---|
| `src/app/admin/page.tsx` | ✅ middleware RBAC | ✅ | audité |
| `src/app/api-docs/page.tsx` | ✅ middleware RBAC | ✅ | audité |
| `src/app/driver/[id]/page.tsx` | ✅ middleware RBAC | ✅ | audité |
| `src/app/driver/page.tsx` | ✅ middleware RBAC | ✅ | audité |
| `src/app/help/page.tsx` | ✅ middleware RBAC | ✅ | audité |
| `src/app/login/page.tsx` | ✅ middleware RBAC | ✅ | audité |
| `src/app/onboarding/page.tsx` | ✅ middleware RBAC | ✅ | audité |
| `src/app/page.tsx` | ✅ middleware RBAC | ✅ | audité |
| `src/app/status/page.tsx` | ✅ middleware RBAC | ✅ | audité |
| `src/app/superadmin/page.tsx` | ✅ middleware RBAC | ✅ | audité |
| `src/app/track/[token]/page.tsx` | ✅ middleware RBAC | ✅ | audité |

## Corrections Phase 2 (avec test de régression)

| # | Faille | Fichier | Fix | Test régression |
|---|---|---|---|---|
| 1 | PUT sans validation Zod des valeurs (latitude=999, type invalide acceptés) | `src/app/api/templates/[id]/route.ts` | `TemplateSchema.partial()` avant écriture | templates.test.ts (4 tests) |
| 2 | Webhook Nessy sans rate limit | `src/app/api/webhooks/nessy/route.ts` | limiter 200/min/IP | webhooks-nessy-obd.test.ts |
| 3 | Webhook Trackdéchets sans rate limit | `src/app/api/webhooks/trackdechets/route.ts` | limiter 200/min/IP | webhooks-trackdechets.test.ts |
| 4 | reset-password sans rate limit (bcrypt = DoS) | `src/app/api/users/[id]/reset-password/route.ts` | limiter 10/min/tenant | reset-password-*.test.ts |
| 5 | undici high vuln (dev-dep jsdom) | package-lock.json | npm audit fix → 0 high/critical | npm audit |

## Corrections Phase 3 — Logique métier (avec test de régression)

| # | Bug | Fichier | Fix | Test régression |
|---|---|---|---|---|
| 6 | Action offline rejetée en 4xx (≠422) restait en file indéfiniment (retryCount jamais incrémenté) | `src/lib/syncQueue.ts` | 4xx → incrément retryCount, sans bloquer la file | syncQueue.test.ts |
| 7 | Même faille dans le service worker + MAX_RETRIES ignoré | `public/sw.js` | putItem + garde retryCount ≥ 5 | e2e/offline-driver.spec.ts (existant) |
| 8 | `TENANT_ID_RE` rejetait les tenantId avec underscore (`t_xxx`) → 500 sur toutes les routes ctx pour ces tenants | `src/lib/data/context.ts` | regex autorise `_` | context.test.ts |
| 9 | `EXUTOIRE_LIST_SELECT` omettait `address` requis par le mapper → GET /api/exutoires 500 en mode DB réelle | `src/lib/data/exutoires.ts` | champ ajouté au select | data.exutoires.test.ts (invariant select ⊇ mapper) |
| 10 | VRP: pas de test toutes-distances-nulles | `src/lib/vrp/__tests__/index.test.ts` | test dégénéré 8 missions même point | vrp index.test.ts |

## Corrections Phase 4 — Performance

| # | Optimisation | Fichier | Avant → Après |
|---|---|---|---|
| 11 | recharts chargé statiquement dans /admin | `src/components/admin/DashboardKPIBar.tsx` | KpiDrilldown lazy (next/dynamic) — /admin 369→253 kB gzip |
| 12 | Bundle Sentry client non optimisé | `next.config.mjs` | bundleSizeOptimizations (debug/replay exclus) |
| 13 | /api/benchmark chargeait toutes les missions pour compter | `src/app/api/benchmark/route.ts` | 2× `prisma.mission.count` (Promise.all) |
| 14 | console.error direct dans ErrorBoundary | `src/components/ErrorBoundary.tsx` | Sentry.captureException + console dev-only |

## Vérifications Phase 3 — cas limites (module → comportement → conforme)

| Module | Cas limite testé | Comportement observé | Conforme |
|---|---|---|---|
| VRP MV-ALNS | 8 missions, distances toutes nulles | Termine, 8/8 comptées (test) | ✅ |
| VRP | Itérations bornées (min 50) + deadlines 3-opt/ejection | Bornes présentes `vrp/index.ts:44,295,300` | ✅ |
| VRP CE 561/2006 | Conduite continue > 270 min | PAUSE 45 min insérée (formatSolution.test.ts:178) | ✅ |
| VRP multi-compartiment | — | multiCompartment.test.ts | ✅ |
| Géocodage | lat=0/lng=0 | Rejeté comme invalide (geocode.ts:99,129 + test:200) | ✅ |
| Trackdéchets crypto | Chiffrer→déchiffrer + mauvaise clé + falsification | Round-trip OK, throw sur mauvaise clé (crypto.test.ts) | ✅ |
| Webhook Trackdéchets | Rejeu du même webhook | Update statut idempotent (même valeur) | ✅ |
| Webhook Nessy | Rejeu du même payload | Dédupliqué par hash SHA-256 (test SEC-M2) | ✅ |
| Sync offline | Double flush concurrent | 2e appel retourne 0 (test) | ✅ |
| Sync offline | 4xx serveur | Corrigé (#6, #7) — retryCount++ puis purge à 5 | ✅ (après fix) |
| SSE | 150 connexions simultanées | Pas de 429, limite 200/tenant configurable (sse-scale.test.ts) | ✅ |
| SSE | Reconnexion chauffeur | Snapshot complet envoyé à la connexion (getSnapshot) | ✅ |
| Push notifications | Retraitement job BullMQ | Throttle Redis par tenant+date + tag navigateur | ✅ |
| Péages | Correspondance préfixe autoroute | Corrigé session mai 2026 (tollDatabase.test.ts) | ✅ |

## Résultats Performance (mesurés, serveur prod local, DB 150 chauffeurs / 1500 missions / 25 exutoires)

### Bundles (gzip, First Load JS)
| Page | Avant | Après | Cible | Atteint |
|---|---|---|---|---|
| / | 182 kB | 182 kB | <200 kB | ✅ |
| /login | 189 kB | 189 kB | <200 kB | ✅ |
| /admin | 369 kB | 253 kB | <200 kB | ❌ (voir justification rapport) |
| /driver/[id] | 201 kB | 201 kB | <200 kB | ≈ (borderline) |
| /superadmin | 202 kB | 202 kB | <200 kB | ≈ (borderline) |

### Latences API (20 req/endpoint, Node fetch, warm)
| Endpoint | p50 | p95 | Cible p95 | Atteint |
|---|---|---|---|---|
| GET /api/missions?date | 8 ms | 17 ms | 300 ms | ✅ |
| GET /api/drivers | 8 ms | 17 ms | 300 ms | ✅ |
| GET /api/plans?date | 7 ms | 10 ms | 300 ms | ✅ |
| GET /api/exutoires | 7 ms | 10 ms | 300 ms | ✅ (500 avant fix #9) |
| GET /api/clients | 7 ms | 7 ms | 300 ms | ✅ |
| GET /api/sites | 8 ms | 14 ms | 300 ms | ✅ |
| GET /api/users | 9 ms | 11 ms | 300 ms | ✅ |
| GET /api/templates | 6 ms | 8 ms | 300 ms | ✅ |
| GET /api/history | 8 ms | 19 ms | 300 ms | ✅ |
| 16 endpoints admin secondaires | — | tous < 250 ms | 300 ms | ✅ |

### Web Vitals (Chrome, serveur prod local)
| Page | TTFB | LCP | CLS | Cibles (500ms/2.5s) |
|---|---|---|---|---|
| /login | 110 ms | 240 ms | 0 | ✅ |
| /admin | 122 ms | 1744 ms | 0 | ✅ |
| /driver | 91 ms | 376 ms | — | ✅ |

### EXPLAIN ANALYZE (PostgreSQL 16, données seedées)
| Requête | Plan | Temps exec |
|---|---|---|
| Mission WHERE tenantId+date+archived | Index Scan `Mission_tenantId_date_idx` | 0.72 ms |
| Plan WHERE tenantId+date | Index Scan `Plan_tenantId_driverId_date_key` | 0.07 ms |
| Driver WHERE tenantId+archived | Seq Scan (150 lignes — choix optimal du planner, index présent) | 0.26 ms |
