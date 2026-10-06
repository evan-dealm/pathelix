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
vi.mock('@/lib/permissions', () => ({ hasPermission: vi.fn(async (_u: string, role: string) => role !== 'driver') }))

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
  vi.unstubAllEnvs()
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

  const llmAnswer = (content: unknown) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }) })

  it('without a configured LLM, answers with the deterministic reading (no network call)', async () => {
    vi.stubEnv('OLLAMA_URL', '')
    const res = await parseNatural(makeParseReq(VALID_PARSE_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('rules')
    expect(body.mission).toMatchObject({ type: 'POSER', clientName: 'Dupont', address: '14 rue des Artisans Lyon' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refuses users without the missions permission', async () => {
    mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'driver', requestId: 'r', trade: null })
    const res = await parseNatural(makeParseReq(VALID_PARSE_BODY))
    expect(res.status).toBe(403)
  })

  it('uses the LLM reading, validated field by field and grounded in the text', async () => {
    vi.stubEnv('OLLAMA_URL', 'http://ollama:11434')
    mockFetch.mockResolvedValueOnce(llmAnswer({ type: 'POSER', address: '14 rue des Artisans, Lyon', clientName: 'Dupont', priority: 9, notes: 'Accès par le portail' }))
    const body = await (await parseNatural(makeParseReq(VALID_PARSE_BODY))).json()
    expect(body.source).toBe('llm')
    expect(body.mission).toMatchObject({ type: 'POSER', address: '14 rue des Artisans, Lyon', clientName: 'Dupont', notes: 'Accès par le portail' })
    expect(body.mission.priority).toBeUndefined()
    expect(body.warnings.join(' ')).toMatch(/priorité/)
  })

  it('drops a client or address the LLM invented', async () => {
    vi.stubEnv('OLLAMA_URL', 'http://ollama:11434')
    mockFetch.mockResolvedValueOnce(llmAnswer({ type: 'RETIRER', address: '1 place Bellecour, Lyon', clientName: 'Durand SA' }))
    const body = await (await parseNatural(makeParseReq(VALID_PARSE_BODY))).json()
    expect(body.mission.clientName).toBe('Dupont') // from the rules, not the invention
    expect(body.mission.address).toBe('14 rue des Artisans Lyon')
    expect(body.warnings.join(' ')).toMatch(/absent de votre texte/)
  })

  it('falls back to the deterministic reading when the LLM fails, then stops calling it (circuit open)', async () => {
    vi.stubEnv('OLLAMA_URL', 'http://ollama:11434')
    mockFetch.mockRejectedValue(new Error('timeout'))
    for (let i = 0; i < 3; i++) {
      const res = await parseNatural(makeParseReq(VALID_PARSE_BODY))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.source).toBe('rules')
      expect(body.warnings.join(' ')).toMatch(/indisponible/)
    }
    mockFetch.mockClear()
    const body = await (await parseNatural(makeParseReq(VALID_PARSE_BODY))).json()
    expect(body.source).toBe('rules')
    expect(mockFetch).not.toHaveBeenCalled()
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
