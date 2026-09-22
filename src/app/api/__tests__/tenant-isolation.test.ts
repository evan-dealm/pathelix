// Route-level cross-tenant isolation proof: exercises real API route handlers against the REAL
// getTenantDb() extension (not mocked) wired to a small in-memory fake Prisma client — so this
// proves the actual extension + actual route code path denies cross-tenant access, not just
// that a mock was called with the right arguments. Complements tenantDb.test.ts (which proves
// the extension's argument-transformation logic exhaustively for all 29 models) and the mocked
// per-route tests (which are faster and check route-specific business logic).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Minimal in-memory fake standing in for the whole Prisma client — enough surface for
// findMany/findFirst/findUnique/create/update/updateMany/count on any model, keyed generically
// by `records[model]`. Real getTenantDb() wraps this via $extends(), so tenant scoping is
// genuinely exercised, not simulated. ──────────────────────────────────────────────────────────
interface FakeRecord { id: string; tenantId: string; [key: string]: unknown }

function makeFakeUnscopedPrisma() {
  const records: Record<string, FakeRecord[]> = {}

  function table(model: string): FakeRecord[] {
    return records[model] ?? (records[model] = [])
  }

  function matches(record: FakeRecord, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true
    return Object.entries(where).every(([k, v]) => {
      if (k === 'AND' || k === 'OR' || k === 'NOT') return true // not needed by these tests
      return record[k] === v
    })
  }

  const client = {
    $extends(config: { query: { $allModels: { $allOperations: (ctx: unknown) => Promise<unknown> } } }) {
      const hook = config.query.$allModels.$allOperations
      return new Proxy({}, {
        get(_t, modelPropName: string) {
          const model = modelPropName.charAt(0).toUpperCase() + modelPropName.slice(1)
          type OpArgs = { where?: Record<string, unknown>; data?: FakeRecord | FakeRecord[] }
          const query = (_args: OpArgs) => {
            const rows = table(model)
            return {
              findFirst:  async (a: OpArgs) => rows.find(r => matches(r, a.where)) ?? null,
              findUnique: async (a: OpArgs) => rows.find(r => matches(r, a.where)) ?? null,
              findMany:   async (a: OpArgs) => rows.filter(r => matches(r, a.where)),
              count:      async (a: OpArgs) => rows.filter(r => matches(r, a.where)).length,
              create:     async (a: OpArgs) => {
                const data = a.data as FakeRecord
                const rec  = { ...data, id: data.id ?? `${model}-${rows.length + 1}` }
                rows.push(rec)
                return rec
              },
              update:     async (a: OpArgs) => {
                const rec = rows.find(r => matches(r, a.where))
                if (!rec) throw Object.assign(new Error('Not found'), { code: 'P2025' })
                Object.assign(rec, a.data)
                return rec
              },
              updateMany: async (a: OpArgs) => {
                const matched = rows.filter(r => matches(r, a.where))
                for (const r of matched) Object.assign(r, a.data)
                return { count: matched.length }
              },
            }
          }
          return new Proxy({}, {
            get(_t2, operation: string) {
              return (args: unknown) => hook({ model, operation, args: args ?? {}, query: (a: unknown) => query(a as never)[operation as 'findFirst'](a as never) })
            },
          })
        },
      })
    },
    __seed(model: string, record: FakeRecord) { table(model).push(record) },
    __records: records,
  }
  return client
}

const fakeUnscopedPrisma = makeFakeUnscopedPrisma()

vi.mock('@/lib/db', () => ({ prisma: fakeUnscopedPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(),
  getRequestContext: vi.fn(),
}))
vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    getOrSet:      vi.fn((_ns: string, _t: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate:    vi.fn(),
    invalidateAll: vi.fn(),
  },
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn() },
  METRIC:  { API_LATENCY_MS: 'l', API_REQUESTS: 'r', API_ERRORS: 'e' },
}))
vi.mock('@/lib/audit', () => ({ auditAsync: vi.fn() }))
vi.mock('@/lib/permissions', () => ({ hasPermission: vi.fn(async () => true) }))

const { getTenantId, getRequestContext } = await import('@/lib/data/context')

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'

function asTenant(tenantId: string, role = 'admin') {
  vi.mocked(getTenantId).mockReturnValue(tenantId)
  vi.mocked(getRequestContext).mockReturnValue({ tenantId, userId: 'u-1', role, requestId: 'r-1', trade: null })
}

beforeEach(() => {
  for (const key of Object.keys(fakeUnscopedPrisma.__records)) delete fakeUnscopedPrisma.__records[key]
  vi.stubEnv('USE_MOCK_DATA', 'false')
})

describe('GET /api/drivers — real route + real getTenantDb, fake DB', () => {
  it('tenant A never sees tenant B drivers, even when both exist', async () => {
    vi.resetModules()
    fakeUnscopedPrisma.__seed('Driver', { id: 'd-a', tenantId: TENANT_A, firstName: 'Alice', lastName: 'A', sector: 'N', depotName: 'D', depotLat: 45, depotLng: 5, archived: false, vehicles: [] } as never)
    fakeUnscopedPrisma.__seed('Driver', { id: 'd-b', tenantId: TENANT_B, firstName: 'Bob',   lastName: 'B', sector: 'N', depotName: 'D', depotLat: 45, depotLng: 5, archived: false, vehicles: [] } as never)

    const { GET } = await import('@/app/api/drivers/route')
    asTenant(TENANT_A)
    const res  = await GET(new NextRequest('http://localhost/api/drivers'))
    const json = await res.json()

    const ids = (json.data as Array<{ id: string }>).map(d => d.id)
    expect(ids).toContain('d-a')
    expect(ids).not.toContain('d-b')
  })
})

describe('GET /api/drivers/[id] — real route + real getTenantDb, fake DB', () => {
  it('tenant A gets 404 for a driver id that exists but belongs to tenant B (no cross-tenant read by id)', async () => {
    vi.resetModules()
    fakeUnscopedPrisma.__seed('Driver', { id: 'd-b', tenantId: TENANT_B, firstName: 'Bob', lastName: 'B', sector: 'N', depotName: 'D', depotLat: 45, depotLng: 5, archived: false, vehicles: [] } as never)

    const { GET } = await import('@/app/api/drivers/[id]/route')
    asTenant(TENANT_A)
    const res = await GET(
      new NextRequest('http://localhost/api/drivers/d-b'),
      { params: Promise.resolve({ id: 'd-b' }) },
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/vehicles — assignedDriverId cross-tenant rejection (real fix, real route)', () => {
  it('rejects assigning a vehicle to a driver that belongs to a different tenant', async () => {
    vi.resetModules()
    fakeUnscopedPrisma.__seed('Driver', { id: 'd-b', tenantId: TENANT_B, firstName: 'Bob', lastName: 'B' } as never)

    const { POST } = await import('@/app/api/vehicles/route')
    asTenant(TENANT_A)
    const res = await POST(new NextRequest('http://localhost/api/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licensePlate: 'AA-111-AA', type: 'Ampliroll', assignedDriverId: 'd-b' }),
    }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toMatch(/introuvable/i)
  })

  it('accepts assigning a vehicle to a driver in the same tenant', async () => {
    vi.resetModules()
    fakeUnscopedPrisma.__seed('Driver', { id: 'd-a', tenantId: TENANT_A, firstName: 'Alice', lastName: 'A' } as never)

    const { POST } = await import('@/app/api/vehicles/route')
    asTenant(TENANT_A)
    const res = await POST(new NextRequest('http://localhost/api/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licensePlate: 'AA-111-AA', type: 'Ampliroll', assignedDriverId: 'd-a' }),
    }))
    expect(res.status).toBe(201)
  })
})
