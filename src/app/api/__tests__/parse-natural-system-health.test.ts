import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// Rate limiter — single mock check for both _ipRl and _tenantRl
const mockRlCheck = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: vi.fn(() => ({ check: mockRlCheck })),
  getClientIp:       vi.fn(() => '127.0.0.1'),
}))

const mockGetCtx = vi.hoisted(() => vi.fn(() => ({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })))
vi.mock('@/lib/data/context', () => ({ getRequestContext: mockGetCtx }))

// Redis + DB for system-health
const mockGetRedis = vi.hoisted(() => vi.fn())
vi.mock('@/lib/redisClient', () => ({ getRedisClient: mockGetRedis }))

const mockQueryRaw = vi.hoisted(() => vi.fn(async () => [{ '?column?': 1 }]))
vi.mock('@/lib/db', () => ({
  default: { $queryRaw: mockQueryRaw },
}))

import { POST as parseNatural }     from '@/app/api/missions/parse-natural/route'
import { GET  as systemHealth }     from '@/app/api/superadmin/system-health/route'

const mockFetch = vi.fn()

function makeParseReq(body: unknown) {
  return new NextRequest('http://localhost/api/missions/parse-natural', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_PARSE_BODY = { text: 'Poser une benne chez Dupont, 14 rue des Artisans Lyon' }

beforeEach(() => {
  vi.clearAllMocks()
  mockRlCheck.mockReset()
  mockRlCheck.mockResolvedValue(true)
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
  vi.stubGlobal('fetch', mockFetch)
})

// ─── POST /api/missions/parse-natural ────────────────────────────────────────

describe('POST /api/missions/parse-natural', () => {
  it('returns 429 when IP rate limited', async () => {
    mockRlCheck.mockResolvedValueOnce(false)
    const res = await parseNatural(makeParseReq(VALID_PARSE_BODY))
    expect(res.status).toBe(429)
  })

  it('returns 401 when getRequestContext throws', async () => {
    mockGetCtx.mockImplementationOnce(() => { throw new Error('no auth') })
    const res = await parseNatural(makeParseReq(VALID_PARSE_BODY))
    expect(res.status).toBe(401)
  })

  it('returns 429 when tenant rate limited (after IP passes)', async () => {
    mockRlCheck
      .mockResolvedValueOnce(true)   // IP check passes
      .mockResolvedValueOnce(false)  // tenant check fails
    const res = await parseNatural(makeParseReq(VALID_PARSE_BODY))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toMatch(/tenant/)
  })

  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/missions/parse-natural', {
      method: 'POST',
      body: '{bad',
    })
    const res = await parseNatural(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when text too short', async () => {
    const res = await parseNatural(makeParseReq({ text: 'Pos' }))
    expect(res.status).toBe(400)
  })

  it('returns 503 when Ollama health check fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 })
    const res = await parseNatural(makeParseReq(VALID_PARSE_BODY))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('OLLAMA_UNAVAILABLE')
  })

  it('returns 503 when Ollama health check throws (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await parseNatural(makeParseReq(VALID_PARSE_BODY))
    expect(res.status).toBe(503)
  })

  it('returns 200 with parsed mission', async () => {
    const llmResponse = { type: 'POSER', address: '14 rue des Artisans', clientName: 'Dupont', estimatedDurationMin: 30 }
    mockFetch
      .mockResolvedValueOnce({ ok: true })  // health check
      .mockResolvedValueOnce({              // LLM call
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(llmResponse) } }],
        }),
      })
    const res = await parseNatural(makeParseReq(VALID_PARSE_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mission.type).toBe('POSER')
    expect(body.mission.address).toBe('14 rue des Artisans')
  })

  it('returns 500 when LLM call fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true })     // health check OK
      .mockRejectedValueOnce(new Error('LLM timeout')) // LLM call throws
    const res = await parseNatural(makeParseReq(VALID_PARSE_BODY))
    expect(res.status).toBe(500)
  })
})

// ─── GET /api/superadmin/system-health ───────────────────────────────────────

describe('GET /api/superadmin/system-health', () => {
  beforeEach(() => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'sa1', role: 'superadmin', requestId: 'req-123', trade: null })
    vi.unstubAllEnvs()
    mockGetRedis.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }])
  })

  it('returns 403 for non-superadmin', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
    const res = await systemHealth(new NextRequest('http://localhost/api/superadmin/system-health'))
    expect(res.status).toBe(403)
  })

  it('returns 200 with redis unavailable and haversine routing', async () => {
    vi.stubEnv('VALHALLA_URL', '')
    vi.stubEnv('OSRM_URL', '')
    const res = await systemHealth(new NextRequest('http://localhost/api/superadmin/system-health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redis.status).toBe('unavailable')
    expect(body.routing.engine).toBe('haversine')
    expect(body.memory).toHaveProperty('heapUsedMb')
    expect(body.database.status).toBe('ok')
    expect(body).toHaveProperty('uptime')
    expect(body).toHaveProperty('node')
  })

  it('returns 200 with redis connected', async () => {
    const mockRedis = {
      info: vi.fn()
        .mockResolvedValueOnce('used_memory_human:42.5M\r\nused_memory_peak_human:50M')
        .mockResolvedValueOnce('connected_clients:3'),
      dbsize: vi.fn().mockResolvedValue(100),
      llen:   vi.fn().mockResolvedValue(2),
      zcard:  vi.fn().mockResolvedValue(5),
    }
    mockGetRedis.mockResolvedValueOnce(mockRedis)
    const res = await systemHealth(new NextRequest('http://localhost/api/superadmin/system-health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redis.status).toBe('connected')
    expect(body.redis.totalKeys).toBe(100)
    expect(body.queue.status).toBe('connected')
  })

  it('returns 200 with Valhalla routing check (ok)', async () => {
    vi.stubEnv('VALHALLA_URL', 'http://valhalla:8002')
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
    const res = await systemHealth(new NextRequest('http://localhost/api/superadmin/system-health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.routing.engine).toBe('valhalla')
    expect(body.routing.status).toBe('ok')
  })

  it('returns 200 with Valhalla routing error', async () => {
    vi.stubEnv('VALHALLA_URL', 'http://valhalla:8002')
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await systemHealth(new NextRequest('http://localhost/api/superadmin/system-health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.routing.status).toBe('error')
    expect(body.routing.engine).toBe('valhalla')
  })

  it('returns 200 with database error', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('DB down'))
    const res = await systemHealth(new NextRequest('http://localhost/api/superadmin/system-health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.database.status).toBe('error')
  })
})
