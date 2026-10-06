/**
 * Structural multi-tenant isolation: `getTenantDb(tenantId)` returns a Prisma Client Extension
 * that injects `tenantId` into every operation on a tenant-scoped model, instead of relying on
 * every call site remembering to add `where: { tenantId }` by hand. Three real cross-tenant
 * bugs were found by manual audit before this existed (`DeliveryProof.driverId`, `ClientSite`
 * links on `PUT /api/clients/[id]`, `driverId` on Geotab/Samsara GPS webhooks) — this makes the
 * mistake structurally harder to make again, it does not replace review.
 *
 * What this extension covers:
 * - `findFirst(OrThrow)`, `findMany`, `findUnique(OrThrow)`, `count`, `aggregate`, `groupBy`:
 *   `tenantId` is merged into `where` (Prisma 7's "extended where" supports combining a unique
 *   key with extra filters on `findUnique`/`update`/`delete`).
 * - `update`, `updateMany`, `delete`, `deleteMany`: same, on the `where`.
 * - `create`, `createMany`, `upsert`: `tenantId` is set on `data` (and `upsert`'s `where`). A
 *   caller that explicitly passes a *different* `tenantId` in `data` throws immediately — this
 *   is always a bug (either a stale value or a genuine attempt to write into another tenant),
 *   never a legitimate use case.
 *
 * What this extension does NOT cover — audited manually instead (see SECURITY.md
 * "Phase 1", section "Ce que l'extension ne couvre pas"):
 * - Nested writes through relations (e.g. `driver.create({ data: { unavailability: { create:
 *   [...] } } })`) — `$allOperations` fires once for the top-level call, never for a nested
 *   relation write, so a nested tenant-scoped create/update is NOT auto-scoped. Audited by
 *   grepping every `connectOrCreate`/nested `{ create: ... }`/`{ update: ... }` in `src/`: only
 *   2 exist in the whole codebase (`clients/route.ts`, `sites/route.ts`), both nested writes on
 *   `ClientSite` — which has no `tenantId` column anyway (see below), so this gap has zero
 *   current exposure. Re-run that grep if new nested writes are added.
 * - Filters inside `include`/`select` (e.g. `include: { missions: { where: {...} } }`) — the
 *   injected top-level `where` does not reach into a relation's own `where`. Audited: zero
 *   `include: { <relation>: { where: ... } }` usages exist anywhere in `src/` today.
 * - `$queryRaw`/`$queryRawUnsafe`/`$executeRaw(Unsafe)` — bypass the extension entirely. Only 4
 *   usages exist in the whole codebase, all `SELECT 1` health checks with zero tenant data
 *   involved (`/api/health`, `/api/ready`, `/api/status`, `/api/superadmin/system-health`).
 * - `ClientSite` — has no `tenantId` column of its own (scoped only transitively via
 *   `clientId`/`siteId`, both of which belong to a tenant); left out of `TENANT_SCOPED_MODELS`
 *   on purpose, since injecting a `tenantId` filter into a model that has no such column would
 *   just throw a Prisma validation error. Every `ClientSite` call site was audited by hand to
 *   confirm its `clientId`/`siteId` are independently tenant-verified before use.
 * - `CustomTrade` — intentionally global (superadmin-managed, shared across all tenants), not a
 *   bug to leave unscoped.
 */

import { prisma as unscopedPrisma } from './db'

/** Re-exported so the whitelist below (and any future one) has one canonical, greppable name. */
export { unscopedPrisma }

// Every Prisma model that has its own `tenantId` column. Kept as an explicit list (not derived
// from `Prisma.dmmf` at runtime) so adding a new model to schema.prisma without adding it here
// is a visible, reviewable diff rather than an implicit behavior change.
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'User', 'Driver', 'Client', 'Site', 'SiteProduct', 'Mission', 'MissionComment', 'Exutoire',
  'Plan', 'TourHistory', 'Vehicle', 'MaintenanceRecord', 'FuelRecord', 'DriverPosition',
  'AuditLog', 'Holiday', 'TenantSettings', 'DriverUnavailability', 'UserPermission', 'ApiKey',
  'WeeklyPlan', 'Integration', 'InterventionMetric', 'TenantMLProfile', 'MissionTemplate',
  'DeliveryProof', 'PushSubscription', 'AiJob', 'TrackdechetsAccount', 'Bsd', 'IdempotencyKey',
  'PlanningNote', 'Material', 'VehicleUnavailability', 'ContainerType', 'Container', 'ContainerEvent',
  'ClientContact', 'CustomerNote', 'PriceList', 'PriceRule', 'DocumentSequence', 'Contract', 'Quote', 'QuoteLine',
  'Order', 'OrderLine', 'Invoice', 'InvoiceLine', 'Payment', 'Weighing', 'Document', 'WebhookEndpoint', 'WebhookDelivery',
  'Notification', 'NotificationPreference', 'PortalUser', 'PortalRequest', 'MaintenancePlan', 'VehicleDefect',
])

const READ_OR_DELETE_WHERE_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany',
])

const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn'])

/**
 * A plain top-level merge (not an `AND`-wrapper) is correct here: Prisma treats every key on a
 * `where` object as an implicit AND, so `{ OR: [...], tenantId }` already means
 * `(...) AND tenantId = X` — no special-casing needed for `OR`/`NOT`/nested filters. Always
 * overwrites any caller-supplied `tenantId` in `where`; this function is the sole authority on
 * tenant scope, a mismatched value there is always either stale or a bug.
 */
function scopedWhere(where: unknown, tenantId: string): Record<string, unknown> {
  return { ...(where as Record<string, unknown> | undefined), tenantId }
}

function scopedCreateData(data: unknown, tenantId: string, model: string): unknown {
  if (Array.isArray(data)) return data.map(d => scopedCreateData(d, tenantId, model))
  const record = data as Record<string, unknown> | undefined
  if (record && 'tenantId' in record && record.tenantId !== undefined && record.tenantId !== tenantId) {
    throw new Error(
      `getTenantDb: refusing to create a ${model} with tenantId "${String(record.tenantId)}" ` +
      `while scoped to tenant "${tenantId}" — this is always a bug, never a legitimate cross-tenant write.`,
    )
  }
  return { ...record, tenantId }
}

/**
 * Returns a Prisma Client bound to one tenant. Every call through it that touches a
 * tenant-scoped model is automatically filtered/stamped with `tenantId` — see the module doc
 * comment above for exactly what is and isn't covered.
 */
export function getTenantDb(tenantId: string) {
  if (!tenantId) {
    throw new Error('getTenantDb() requires a non-empty tenantId — never call it with an unverified/undefined value.')
  }

  return unscopedPrisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) return query(args)

          if (READ_OR_DELETE_WHERE_OPS.has(operation)) {
            args.where = scopedWhere(args.where, tenantId)
          } else if (CREATE_OPS.has(operation)) {
            args.data = scopedCreateData(args.data, tenantId, model)
          } else if (operation === 'upsert') {
            args.where  = scopedWhere(args.where, tenantId)
            args.create = scopedCreateData(args.create, tenantId, model)
            // `update` on an upsert never changes tenantId — no need to touch args.update.
          } else {
            // Fail closed: an operation added by a future Prisma version must be reviewed and
            // scoped here, never silently run unscoped against a tenant-scoped model.
            throw new Error(`getTenantDb: operation "${operation}" on ${model} is not tenant-scoped`)
          }

          return query(args)
        },
      },
    },
  })
}

export type TenantDb = ReturnType<typeof getTenantDb>
