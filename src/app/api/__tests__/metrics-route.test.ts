/**
 * Tests for GET /api/metrics — export Prometheus.
 * Auth: Bearer METRICS_TOKEN si défini, sinon session JWT obligatoire.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

const mockVerifySession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session', () => ({
  verifySession: mockVerifySession,
  SESSION_COOKIE: 'session',
}))

vi.mock('@/lib/metrics', () => ({
  metrics: {
    snapshot: vi.fn(() => ({
      counters: { 'api.requests{route=/api/test}': { value: 42 } },
      histograms: { 'api.latency_ms': { count: 10, sum: 500, p50: 40, p95: 90, p99: 120 } },
    })),
  },
}))

vi.mock('@/lib/circuitBreaker', () => ({
  getAllCircuitStates: vi.fn(() => ({ valhalla: 'CLOSED', nessy: 'OPEN' })),
}))

vi.mock('@/lib/loadShedder', () => ({
  loadShedder: { concurrent: 3 },
}))

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/metrics', { headers })
}

afterAll(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('GET /api/metrics — sans METRICS_TOKEN (fallback session)', () => {
  let GET: (req: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.stubEnv('METRICS_TOKEN', '')
    vi.resetModules()
    ;({ GET } = await import('@/app/api/metrics/route'))
    mockVerifySession.mockReset()
  })

  it('returns 401 without session', async () => {
    mockVerifySession.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 200 with valid session and Prometheus format', async () => {
    mockVerifySession.mockResolvedValue({ sub: 'u1', role: 'admin', tenantId: 't1' })
    const req = new NextRequest('http://localhost/api/metrics', {
      headers: { cookie: 'session=valid-token' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('process_uptime_seconds')
    expect(body).toContain('load_concurrent 3')
    expect(body).toContain('circuit_breaker_state{name="valhalla"} 0')
    expect(body).toContain('circuit_breaker_state{name="nessy"} 2')
    expect(body).toContain('api_requests_total{route="/api/test"} 42')
    expect(body).toContain('api_latency_ms_p95 90')
    expect(res.headers.get('content-type')).toContain('text/plain')
  })
})

describe('GET /api/metrics — avec METRICS_TOKEN', () => {
  let GET: (req: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.stubEnv('METRICS_TOKEN', 'secret-metrics-token-123')
    vi.resetModules()
    ;({ GET } = await import('@/app/api/metrics/route'))
    mockVerifySession.mockReset()
  })

  it('returns 401 without Bearer token', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong token', async () => {
    const res = await GET(makeReq({ authorization: 'Bearer wrong-token' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 with token of same length but different value (timingSafeEqual)', async () => {
    const res = await GET(makeReq({ authorization: 'Bearer secret-metrics-token-124' }))
    expect(res.status).toBe(401)
  })

  it('returns 200 with correct token', async () => {
    const res = await GET(makeReq({ authorization: 'Bearer secret-metrics-token-123' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('process_uptime_seconds')
  })

  it('does not fall back to session when token set but invalid', async () => {
    mockVerifySession.mockResolvedValue({ sub: 'u1', role: 'admin', tenantId: 't1' })
    const req = new NextRequest('http://localhost/api/metrics', {
      headers: { cookie: 'session=valid', authorization: 'Bearer bad' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})
