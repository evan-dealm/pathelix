import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockPrisma } = vi.hoisted(() => {
  process.env.USE_MOCK_DATA = 'false'
  const mockPrisma = {
    customTrade: {
      findMany: vi.fn(),
      create:   vi.fn(),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getTenantId:       vi.fn(() => 'tenant-test'),
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-test', userId: 'sa-1', role: 'superadmin', requestId: 'req-1', trade: null })),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}))

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn(async () => null),
}))

import { GET as tradesGet, POST as tradesPost } from '@/app/api/superadmin/trades/route'
import { GET as systemHealthGet }               from '@/app/api/superadmin/system-health/route'
import { getRequestContext }                    from '@/lib/data/context'
import { getTradeConfig, unregisterCustomTrade } from '@/lib/trades'

function makeReq(
  url: string,
  opts: { method?: string; body?: unknown } = {},
): NextRequest {
  return new NextRequest(url, {
    method:  opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body:    opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

const validTradeBody = {
  tradeKey:            'custom_sector',
  tradeName:           'Mon secteur',
  tradeDescription:    'Description',
  tradeIcon:           '🔧',
  vocabulary:          { tradeName: 'Mon secteur', sector: 'secteur' },
  enabledMissionTypes: ['POSER', 'RETIRER'],
}

// ─── GET /api/superadmin/trades ───────────────────────────────────────────────

describe('GET /api/superadmin/trades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 'tenant-test', userId: 'sa-1', role: 'superadmin', requestId: 'req-1', trade: null,
    })
    mockPrisma.customTrade.findMany.mockResolvedValue([])
  })

  it('returns 403 for non-superadmin role', async () => {
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 'tenant-test', userId: 'u1', role: 'admin', requestId: 'req-1', trade: null,
    })
    const res = await tradesGet(makeReq('http://localhost/api/superadmin/trades'))
    expect(res.status).toBe(403)
  })

  it('returns built-in trades with isBuiltIn=true', async () => {
    const res = await tradesGet(makeReq('http://localhost/api/superadmin/trades'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(json.trades)).toBe(true)
    // All built-in trades should have isBuiltIn=true
    const builtIn = json.trades.filter((t: { isBuiltIn: boolean }) => t.isBuiltIn)
    expect(builtIn.length).toBeGreaterThan(0)
    expect(builtIn.every((t: { id: string }) => t.id.startsWith('builtin:'))).toBe(true)
  })

  it('includes custom trades with isBuiltIn=false', async () => {
    mockPrisma.customTrade.findMany.mockResolvedValue([{
      id: 'ct-1',
      tradeKey: 'custom',
      tradeName: 'Custom',
      tradeDescription: 'desc',
      tradeIcon: '🔧',
      enabledMissionTypes: ['POSER'],
      vocabulary: {},
      createdAt: new Date('2026-01-01'),
    }])
    const res = await tradesGet(makeReq('http://localhost/api/superadmin/trades'))
    const json = await res.json()
    const custom = json.trades.filter((t: { isBuiltIn: boolean }) => !t.isBuiltIn)
    expect(custom).toHaveLength(1)
    expect(custom[0].tradeKey).toBe('custom')
    expect(custom[0].createdAt).toBeDefined()
  })

  it('returns 500 on DB error', async () => {
    mockPrisma.customTrade.findMany.mockRejectedValue(new Error('DB fail'))
    const res = await tradesGet(makeReq('http://localhost/api/superadmin/trades'))
    expect(res.status).toBe(500)
  })
})

// ─── POST /api/superadmin/trades ──────────────────────────────────────────────

describe('POST /api/superadmin/trades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 'tenant-test', userId: 'sa-1', role: 'superadmin', requestId: 'req-1', trade: null,
    })
  })

  it('returns 403 for non-superadmin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 'tenant-test', userId: 'u1', role: 'admin', requestId: 'req-1', trade: null,
    })
    const res = await tradesPost(makeReq('http://localhost/api/superadmin/trades', {
      method: 'POST', body: validTradeBody,
    }))
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/superadmin/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await tradesPost(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 for invalid tradeKey (uppercase not allowed)', async () => {
    const res = await tradesPost(makeReq('http://localhost/api/superadmin/trades', {
      method: 'POST',
      body: { ...validTradeBody, tradeKey: 'Invalid-Key' },
    }))
    expect(res.status).toBe(422)
  })

  it('returns 409 when tradeKey conflicts with a built-in trade', async () => {
    // 'collecte_recyclage' is a built-in trade key from TRADE_IDS
    const res = await tradesPost(makeReq('http://localhost/api/superadmin/trades', {
      method: 'POST',
      body: { ...validTradeBody, tradeKey: 'collecte_recyclage' },
    }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/réservée/i)
  })

  it('creates trade and returns 201', async () => {
    const created = { id: 'ct-1', ...validTradeBody, createdAt: new Date() }
    mockPrisma.customTrade.create.mockResolvedValue(created)
    const res = await tradesPost(makeReq('http://localhost/api/superadmin/trades', {
      method: 'POST', body: validTradeBody,
    }))
    expect(res.status).toBe(201)
    expect(mockPrisma.customTrade.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tradeKey: 'custom_sector' }),
      }),
    )
  })

  // Regression M5: registerCustomTrade() was never called anywhere — a custom trade created via
  // this route was persisted to the DB but getTradeConfig() (used everywhere at runtime: mission
  // type filtering, VRP vocabulary, ML accuracy stats) silently fell back to DEFAULT_TRADE for
  // any tenant assigned to it, with no error surfaced.
  it('registers the new trade so getTradeConfig() resolves it immediately (same process, no restart needed)', async () => {
    const created = { id: 'ct-2', ...validTradeBody, tradeKey: 'custom_sector_live', createdAt: new Date() }
    mockPrisma.customTrade.create.mockResolvedValue(created)

    try {
      const res = await tradesPost(makeReq('http://localhost/api/superadmin/trades', {
        method: 'POST', body: { ...validTradeBody, tradeKey: 'custom_sector_live' },
      }))
      expect(res.status).toBe(201)

      const config = getTradeConfig('custom_sector_live')
      expect(config.id).toBe('custom_sector_live')
      expect(config.enabledMissionTypes).toEqual(['POSER', 'RETIRER'])
    } finally {
      unregisterCustomTrade('custom_sector_live')
    }
  })

  it('returns 409 on unique constraint violation', async () => {
    mockPrisma.customTrade.create.mockRejectedValue(new Error('Unique constraint'))
    const res = await tradesPost(makeReq('http://localhost/api/superadmin/trades', {
      method: 'POST', body: validTradeBody,
    }))
    expect(res.status).toBe(409)
  })

  it('returns 500 on other DB errors', async () => {
    mockPrisma.customTrade.create.mockRejectedValue(new Error('Connection error'))
    const res = await tradesPost(makeReq('http://localhost/api/superadmin/trades', {
      method: 'POST', body: validTradeBody,
    }))
    expect(res.status).toBe(500)
  })
})

// ─── GET /api/superadmin/system-health ───────────────────────────────────────

describe('GET /api/superadmin/system-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 'tenant-test', userId: 'sa-1', role: 'superadmin', requestId: 'req-1', trade: null,
    })
  })

  it('returns 403 for non-superadmin', async () => {
    vi.mocked(getRequestContext).mockReturnValue({
      tenantId: 'tenant-test', userId: 'u1', role: 'admin', requestId: 'req-1', trade: null,
    })
    const res = await systemHealthGet(makeReq('http://localhost/api/superadmin/system-health'))
    expect(res.status).toBe(403)
  })

  it('returns 200 with memory and process info', async () => {
    const res = await systemHealthGet(makeReq('http://localhost/api/superadmin/system-health'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.memory).toBeDefined()
    expect(typeof json.memory.heapUsedMb).toBe('number')
    expect(typeof json.memory.heapTotalMb).toBe('number')
    expect(json.memory.usagePercent).toBeGreaterThanOrEqual(0)
    expect(json.memory.usagePercent).toBeLessThanOrEqual(100)
  })

  it('returns redis status as unavailable when no redis client', async () => {
    const res = await systemHealthGet(makeReq('http://localhost/api/superadmin/system-health'))
    const json = await res.json()
    expect(json.redis).toBeDefined()
    expect(json.redis.status).toBe('unavailable')
  })

  it('returns node and uptime metadata', async () => {
    const res = await systemHealthGet(makeReq('http://localhost/api/superadmin/system-health'))
    const json = await res.json()
    expect(json.node).toBeDefined()
    expect(typeof json.node.version).toBe('string')
    expect(json.uptime).toBeDefined()
    expect(typeof json.uptime.seconds).toBe('number')
    expect(json.uptime.seconds).toBeGreaterThanOrEqual(0)
  })
})
