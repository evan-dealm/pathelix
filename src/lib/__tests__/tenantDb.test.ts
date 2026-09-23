import { describe, it, expect, vi } from 'vitest'

// Fakes the exact slice of the Prisma Client surface getTenantDb() depends on: `.$extends()`
// registers a `query.$allModels.$allOperations` hook; this fake drives that hook the same way
// the real Prisma runtime does (one call per model.operation invocation) and returns the final
// `args` it was called with, so tests can assert on the *transformed* arguments — proving the
// extension's isolation logic directly, without needing a real database. See tenantDb.ts's
// module doc comment for why this — not a live sandbox round-trip — is the right level to prove
// this specific claim (real end-to-end proof against real API routes with two real tenants is
// covered instead by e2e/tenant-isolation.spec.ts).
const OPERATIONS = [
  'findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany',
  'create', 'createMany', 'upsert',
] as const

function fakeUnscopedClient() {
  let hook: ((ctx: any) => Promise<any>) | null = null
  return {
    $extends(config: any) {
      hook = config.query.$allModels.$allOperations
      // Mirrors real Prisma clients: any property access (`.mission`, `.driver`, ...) yields an
      // operations object, keyed by the PascalCase model name (`mission` -> `Mission`).
      return new Proxy({}, {
        get(_target, modelPropName: string) {
          const model = modelPropName.charAt(0).toUpperCase() + modelPropName.slice(1)
          const proxy: Record<string, (args: unknown) => Promise<unknown>> = {}
          for (const operation of OPERATIONS) {
            proxy[operation] = (args: unknown) =>
              hook!({ model, operation, args: args ?? {}, query: async (a: unknown) => a })
          }
          return proxy
        },
      })
    },
  }
}

vi.mock('../db', () => ({ prisma: fakeUnscopedClient() }))

const { getTenantDb } = await import('../tenantDb')

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'

// Mirrors TENANT_SCOPED_MODELS in tenantDb.ts, lowercased the way Prisma's client property
// names are (the extension itself keys off the PascalCase `model` name from Prisma's runtime,
// this list only drives which `.model(...)` proxy this test exercises).
const TENANT_SCOPED_MODELS = [
  'User', 'Driver', 'Client', 'Site', 'SiteProduct', 'Mission', 'MissionComment', 'Exutoire',
  'Plan', 'TourHistory', 'Vehicle', 'MaintenanceRecord', 'FuelRecord', 'DriverPosition',
  'AuditLog', 'Holiday', 'TenantSettings', 'DriverUnavailability', 'UserPermission', 'ApiKey',
  'WeeklyPlan', 'Integration', 'InterventionMetric', 'TenantMLProfile', 'MissionTemplate',
  'DeliveryProof', 'PushSubscription', 'AiJob', 'TrackdechetsAccount', 'Bsd', 'IdempotencyKey',
  'PlanningNote',
]

describe('getTenantDb — every tenant-scoped model, read/write isolation', () => {
  it.each(TENANT_SCOPED_MODELS)('%s: findMany/findFirst/count/aggregate/groupBy always filter by tenantId', async (model) => {
    const db = getTenantDb(TENANT_A) as any
    for (const op of ['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'] as const) {
      const result = await db[model.charAt(0).toLowerCase() + model.slice(1)][op]({ where: { archived: false } })
      expect(result.where).toMatchObject({ archived: false, tenantId: TENANT_A })
    }
  })

  it.each(TENANT_SCOPED_MODELS)('%s: findUnique/update/delete by id still gets tenantId merged into where (extended where)', async (model) => {
    const db = getTenantDb(TENANT_A) as any
    for (const op of ['findUnique', 'findUniqueOrThrow', 'update', 'delete'] as const) {
      const result = await db[model.charAt(0).toLowerCase() + model.slice(1)][op]({ where: { id: 'rec-1' } })
      expect(result.where).toEqual({ id: 'rec-1', tenantId: TENANT_A })
    }
  })

  it.each(TENANT_SCOPED_MODELS)('%s: a tenantId in where from another tenant is overwritten, never trusted from the caller', async (model) => {
    const db = getTenantDb(TENANT_A) as any
    const result = await db[model.charAt(0).toLowerCase() + model.slice(1)].findFirst({ where: { id: 'rec-1', tenantId: TENANT_B } })
    expect(result.where.tenantId).toBe(TENANT_A)
  })

  it.each(TENANT_SCOPED_MODELS)('%s: create stamps tenantId onto data', async (model) => {
    const db = getTenantDb(TENANT_A) as any
    const result = await db[model.charAt(0).toLowerCase() + model.slice(1)].create({ data: { name: 'x' } })
    expect(result.data).toMatchObject({ name: 'x', tenantId: TENANT_A })
  })

  it.each(TENANT_SCOPED_MODELS)('%s: create with a mismatched explicit tenantId in data throws instead of silently overwriting', async (model) => {
    const db = getTenantDb(TENANT_A) as any
    await expect(
      db[model.charAt(0).toLowerCase() + model.slice(1)].create({ data: { name: 'x', tenantId: TENANT_B } }),
    ).rejects.toThrow(/refusing to create/)
  })

  it.each(TENANT_SCOPED_MODELS)('%s: createMany stamps tenantId on every row', async (model) => {
    const db = getTenantDb(TENANT_A) as any
    const result = await db[model.charAt(0).toLowerCase() + model.slice(1)].createMany({
      data: [{ name: 'a' }, { name: 'b', tenantId: TENANT_A }],
    })
    expect(result.data).toEqual([
      { name: 'a', tenantId: TENANT_A },
      { name: 'b', tenantId: TENANT_A },
    ])
  })

  it.each(TENANT_SCOPED_MODELS)('%s: upsert scopes both where and create', async (model) => {
    const db = getTenantDb(TENANT_A) as any
    const result = await db[model.charAt(0).toLowerCase() + model.slice(1)].upsert({
      where:  { id: 'rec-1' },
      create: { name: 'x' },
      update: { name: 'y' },
    })
    expect(result.where).toEqual({ id: 'rec-1', tenantId: TENANT_A })
    expect(result.create).toMatchObject({ name: 'x', tenantId: TENANT_A })
    expect(result.update).toEqual({ name: 'y' }) // update never touches tenantId — the where already pins the row
  })
})

describe('getTenantDb — non-tenant-scoped models pass through untouched', () => {
  it('Tenant model itself is never filtered by tenantId (it IS the tenant)', async () => {
    const db = getTenantDb(TENANT_A) as any
    const result = await db.tenant.findUnique({ where: { id: 'some-other-tenant-id' } })
    expect(result.where).toEqual({ id: 'some-other-tenant-id' })
  })

  it('CustomTrade (intentionally global/cross-tenant) is never filtered', async () => {
    const db = getTenantDb(TENANT_A) as any
    const result = await db.customTrade.findMany({ where: {} })
    expect(result.where).toEqual({})
  })
})

describe('getTenantDb — guardrails', () => {
  it('throws synchronously if called with an empty tenantId', () => {
    expect(() => getTenantDb('')).toThrow(/non-empty tenantId/)
  })
})
