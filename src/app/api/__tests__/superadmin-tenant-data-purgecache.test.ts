import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', userId: 'sa1', role: 'superadmin' })),
}))
vi.mock('@/lib/superadminAudit', () => ({
  logSuperadminAction: vi.fn(),
}))

const mockTenantFindUnique    = vi.hoisted(() => vi.fn())
const mockUserFindMany        = vi.hoisted(() => vi.fn())
const mockDriverFindMany      = vi.hoisted(() => vi.fn())
const mockVehicleFindMany     = vi.hoisted(() => vi.fn())
const mockMissionFindMany     = vi.hoisted(() => vi.fn())
const mockMissionCount        = vi.hoisted(() => vi.fn())
const mockExutoireFindMany    = vi.hoisted(() => vi.fn())
const mockClientFindMany      = vi.hoisted(() => vi.fn())
const mockSiteFindMany        = vi.hoisted(() => vi.fn())
const mockTemplateFindMany    = vi.hoisted(() => vi.fn())
const mockSettingsFindUnique  = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: {
    tenant:          { findUnique:  mockTenantFindUnique    },
    user:            { findMany:    mockUserFindMany         },
    driver:          { findMany:    mockDriverFindMany       },
    vehicle:         { findMany:    mockVehicleFindMany      },
    mission:         { findMany:    mockMissionFindMany, count: mockMissionCount },
    exutoire:        { findMany:    mockExutoireFindMany     },
    client:          { findMany:    mockClientFindMany       },
    site:            { findMany:    mockSiteFindMany         },
    missionTemplate: { findMany:    mockTemplateFindMany     },
    tenantSettings:  { findUnique:  mockSettingsFindUnique   },
  },
}))

const mockGetRedis = vi.hoisted(() => vi.fn())
vi.mock('@/lib/redisClient', () => ({ getRedisClient: mockGetRedis }))

import { GET }  from '@/app/api/superadmin/tenants/[id]/data/route'
import { POST } from '@/app/api/superadmin/tenants/[id]/purge-cache/route'
import { getRequestContext } from '@/lib/data/context'

const mockGetCtx = vi.mocked(getRequestContext)

function makeGET(tenantId: string, section?: string) {
  const url = new URL(`http://localhost/api/superadmin/tenants/${tenantId}/data`)
  if (section) url.searchParams.set('section', section)
  return new NextRequest(url)
}

function makePOST(tenantId: string) {
  return new NextRequest(`http://localhost/api/superadmin/tenants/${tenantId}/purge-cache`, {
    method: 'POST',
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const TENANT = { id: 'tenant-x', name: 'ACME Corp' }
const EMPTY  = [] as const

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'sa1', role: 'superadmin', requestId: 'req-123', trade: null })
  // Default all DB calls to return empty
  mockTenantFindUnique.mockResolvedValue(TENANT)
  mockUserFindMany.mockResolvedValue(EMPTY)
  mockDriverFindMany.mockResolvedValue(EMPTY)
  mockVehicleFindMany.mockResolvedValue(EMPTY)
  mockMissionFindMany.mockResolvedValue(EMPTY)
  mockMissionCount.mockResolvedValue(0)
  mockExutoireFindMany.mockResolvedValue(EMPTY)
  mockClientFindMany.mockResolvedValue(EMPTY)
  mockSiteFindMany.mockResolvedValue(EMPTY)
  mockTemplateFindMany.mockResolvedValue(EMPTY)
  mockSettingsFindUnique.mockResolvedValue(null)
})

// ─── GET /api/superadmin/tenants/[id]/data ────────────────────────────────────

describe('GET /api/superadmin/tenants/[id]/data', () => {
  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await GET(makeGET('tenant-x'), makeParams('tenant-x'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when tenant not found', async () => {
    mockTenantFindUnique.mockResolvedValueOnce(null)
    const res = await GET(makeGET('ghost'), makeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns all sections when section=all (default)', async () => {
    const res = await GET(makeGET('tenant-x'), makeParams('tenant-x'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tenantId).toBe('tenant-x')
    expect(body.tenantName).toBe('ACME Corp')
    expect(body).toHaveProperty('users')
    expect(body).toHaveProperty('drivers')
    expect(body).toHaveProperty('vehicles')
    expect(body).toHaveProperty('missions')
    expect(body).toHaveProperty('exutoires')
    expect(body).toHaveProperty('clients')
    expect(body).toHaveProperty('sites')
    expect(body).toHaveProperty('templates')
    expect(body).toHaveProperty('settings')
  })

  it('returns only users when section=users', async () => {
    const res = await GET(makeGET('tenant-x', 'users'), makeParams('tenant-x'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('users')
    expect(body).not.toHaveProperty('drivers')
    expect(body).not.toHaveProperty('vehicles')
  })

  it('returns only missions when section=missions', async () => {
    mockMissionFindMany.mockResolvedValueOnce([{ id: 'm1', type: 'POSER' }])
    mockMissionCount.mockResolvedValueOnce(42)
    const res = await GET(makeGET('tenant-x', 'missions'), makeParams('tenant-x'))
    const body = await res.json()
    expect(body).toHaveProperty('missions')
    expect(body).toHaveProperty('missionsTotal', 42)
    expect(body).not.toHaveProperty('users')
  })

  it('returns 500 on DB error', async () => {
    mockTenantFindUnique.mockRejectedValueOnce(new Error('DB timeout'))
    const res = await GET(makeGET('tenant-x'), makeParams('tenant-x'))
    expect(res.status).toBe(500)
  })
})

// ─── POST /api/superadmin/tenants/[id]/purge-cache ────────────────────────────

describe('POST /api/superadmin/tenants/[id]/purge-cache', () => {
  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await POST(makePOST('tenant-x'), makeParams('tenant-x'))
    expect(res.status).toBe(403)
  })

  it('returns ok with purged=0 when Redis not available', async () => {
    mockGetRedis.mockResolvedValueOnce(null)
    const res = await POST(makePOST('tenant-x'), makeParams('tenant-x'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.purged).toBe(0)
    expect(body.message).toMatch(/redis/i)
  })

  it('scans and deletes keys when Redis available', async () => {
    const mockRedis = {
      scan: vi.fn()
        .mockResolvedValueOnce(['0', ['key1', 'key2']])  // first pattern, single page
        .mockResolvedValueOnce(['0', []])                  // second pattern
        .mockResolvedValueOnce(['0', ['key3']]),           // third pattern
      del: vi.fn().mockResolvedValue(2),
    }
    mockGetRedis.mockResolvedValueOnce(mockRedis)

    const res = await POST(makePOST('tenant-x'), makeParams('tenant-x'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.purged).toBe(3) // key1+key2 + key3
  })

  it('returns 500 on Redis error', async () => {
    mockGetRedis.mockRejectedValueOnce(new Error('Redis crash'))
    const res = await POST(makePOST('tenant-x'), makeParams('tenant-x'))
    expect(res.status).toBe(500)
  })
})
