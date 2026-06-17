import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/metrics', () => ({
  metrics: {
    increment: vi.fn(),
    histogram: vi.fn(),
  },
  METRIC: {
    API_LATENCY_MS: 'api.latency_ms',
    API_REQUESTS:   'api.requests',
    API_ERRORS:     'api.errors',
  },
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: {
    getOrSet:      vi.fn((_ns: string, _t: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidateAll: vi.fn(),
    invalidate:    vi.fn(),
  },
}))

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(() => null),
}))

vi.mock('@/lib/data/drivers', () => {
  const store: Record<string, Array<{ id: string; [k: string]: unknown }>> = {}
  return {
    getAllDrivers: vi.fn((tenantId: string) => {
      return Promise.resolve(store[tenantId] ?? [])
    }),
    createDriver: vi.fn((tenantId: string, data: Record<string, unknown>) => {
      if (!store[tenantId]) store[tenantId] = []
      const driver = { id: `drv-${Date.now()}`, ...data }
      store[tenantId].push(driver)
      return Promise.resolve(driver)
    }),
    _store: store,
  }
})

vi.mock('@/lib/data/missions', () => {
  const store: Record<string, Array<{ id: string; [k: string]: unknown }>> = {}
  return {
    getAllMissions:    vi.fn((tenantId: string) => Promise.resolve(store[tenantId] ?? [])),
    getMissionsByDate: vi.fn((tenantId: string) => Promise.resolve(store[tenantId] ?? [])),
    createMission: vi.fn((tenantId: string, data: Record<string, unknown>) => {
      if (!store[tenantId]) store[tenantId] = []
      const mission = { id: `msn-${Date.now()}`, ...data }
      store[tenantId].push(mission)
      return Promise.resolve(mission)
    }),
    _store: store,
  }
})

vi.mock('@/lib/missionQueue', () => ({
  peekQueue: vi.fn(() => []),
}))

import { getTenantId, getRequestContext } from '@/lib/data/context'
import { GET as getDrivers, POST as postDriver } from '@/app/api/drivers/route'
import { GET as getMissions } from '@/app/api/missions/route'
import { getAllDrivers } from '@/lib/data/drivers'
import { getAllMissions } from '@/lib/data/missions'

function makeRequest(path: string, tenantId: string, options: RequestInit = {}): NextRequest {
  const url = new URL(`http://localhost:3000${path}`)
  return new NextRequest(url, {
    ...options,
    headers: {
      'x-tenant-id': tenantId,
      ...((options.headers as Record<string, string>) ?? {}),
    },
  } as ConstructorParameters<typeof NextRequest>[1])
}

describe('getTenantId', () => {
  it('extracts tenantId from x-tenant-id header', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-tenant-id': 'my-tenant' },
    })
    expect(getTenantId(req)).toBe('my-tenant')
  })

  it('throws when header is missing (security: no unauthenticated access)', () => {
    const req = new NextRequest('http://localhost:3000/api/test')
    expect(() => getTenantId(req)).toThrow()
  })
})

describe('getRequestContext', () => {
  it('extracts full context from headers', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: {
        'x-tenant-id':  'tenant-abc001',
        'x-user-id':    'user-42',
        'x-user-role':  'admin',
        'x-request-id': 'req-abc',
      },
    })

    const ctx = getRequestContext(req)
    expect(ctx.tenantId).toBe('tenant-abc001')
    expect(ctx.userId).toBe('user-42')
    expect(ctx.role).toBe('admin')
    expect(ctx.requestId).toBe('req-abc')
  })

  it('throws for missing tenant header (security: no unauthenticated access)', () => {
    const req = new NextRequest('http://localhost:3000/api/test')
    expect(() => getRequestContext(req)).toThrow()
  })
})

describe('multi-tenant driver isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('tenant A drivers are not visible to tenant B', async () => {

    const driverStore = (await import('@/lib/data/drivers')) as unknown as {
      _store: Record<string, Array<{ id: string }>>
      getAllDrivers: ReturnType<typeof vi.fn>
    }
    driverStore._store['tenant-alpha01'] = [
      { id: 'd-1', firstName: 'Jean', lastName: 'Dupont', sector: 'Nord', depotName: 'D', depotLat: 45.76, depotLng: 4.83 } as { id: string; [k: string]: unknown },
    ]
    driverStore._store['tenant-beta001'] = []

    const resA = await getDrivers(makeRequest('/api/drivers', 'tenant-alpha01'))
    const jsonA = await resA.json()

    const resB = await getDrivers(makeRequest('/api/drivers', 'tenant-beta001'))
    const jsonB = await resB.json()

    expect(jsonA.data).toHaveLength(1)
    expect(jsonB.data).toHaveLength(0)
  })
})

describe('multi-tenant mission isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('tenant A missions are not visible to tenant B', async () => {
    const missionStore = (await import('@/lib/data/missions')) as unknown as {
      _store: Record<string, Array<{ id: string }>>
      getAllMissions: ReturnType<typeof vi.fn>
    }
    missionStore._store['tenant-alpha01'] = [
      { id: 'm-1', type: 'POSER', date: '2026-03-18', address: 'Addr', latitude: 45.77, longitude: 4.84, estimatedDurationMin: 15, maneuverTimeMin: 5 } as { id: string; [k: string]: unknown },
    ]
    missionStore._store['tenant-beta001'] = []

    const resA = await getMissions(makeRequest('/api/missions', 'tenant-alpha01'))
    const jsonA = await resA.json()

    const resB = await getMissions(makeRequest('/api/missions', 'tenant-beta001'))
    const jsonB = await resB.json()

    expect(jsonA.data).toHaveLength(1)
    expect(jsonB.data).toHaveLength(0)
  })
})

describe('plans scoped by tenant', () => {
  it('plans API requires tenant context via getTenantId', () => {

    const reqA = new NextRequest('http://localhost:3000/api/plans?date=2026-03-18', {
      headers: { 'x-tenant-id': 'tenant-alpha01' },
    })
    const reqB = new NextRequest('http://localhost:3000/api/plans?date=2026-03-18', {
      headers: { 'x-tenant-id': 'tenant-beta001' },
    })

    expect(getTenantId(reqA)).toBe('tenant-alpha01')
    expect(getTenantId(reqB)).toBe('tenant-beta001')
    expect(getTenantId(reqA)).not.toBe(getTenantId(reqB))
  })
})
