import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', role: 'admin' })),
}))

const mockVerifySession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session', () => ({
  verifySession:  mockVerifySession,
  SESSION_COOKIE: 'session',
}))

const mockGeneratePrometheus = vi.hoisted(() => vi.fn(() => '# HELP requests_total Total requests\nrequests_total 42\n'))
vi.mock('@/lib/prometheus', () => ({
  generatePrometheusMetrics: mockGeneratePrometheus,
}))

const mockRegisterSSE = vi.hoisted(() => vi.fn(() => () => {}))
vi.mock('@/lib/incidentBroadcast', () => ({
  registerIncidentSSE: mockRegisterSSE,
}))

import { GET as prometheusGET } from '@/app/api/metrics/prometheus/route'
import { GET as incidentSSEGET } from '@/app/api/sse/incidents/route'
import { getRequestContext } from '@/lib/data/context'

const mockGetCtx = vi.mocked(getRequestContext)

function makeReq(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mockGetCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'req-123', trade: null })
})

// ─── GET /api/metrics/prometheus ──────────────────────────────────────────────

describe('GET /api/metrics/prometheus', () => {
  beforeEach(() => {
    // Reset Once queue between tests to prevent mock bleeding
    mockVerifySession.mockReset()
  })

  it('returns 401 when no METRICS_TOKEN and no session cookie', async () => {
    vi.stubEnv('METRICS_TOKEN', '')
    const req = makeReq('http://localhost/api/metrics/prometheus')
    const res = await prometheusGET(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when no METRICS_TOKEN and session is driver role', async () => {
    vi.stubEnv('METRICS_TOKEN', '')
    mockVerifySession.mockResolvedValueOnce({ role: 'driver', sub: 'u1', tenantId: 't1', exp: 9999999999, iat: 0 })
    const req = new NextRequest('http://localhost/api/metrics/prometheus', {
      headers: { cookie: 'session=tok' },
    })
    const res = await prometheusGET(req)
    expect(res.status).toBe(401)
  })

  it('returns Prometheus text when no METRICS_TOKEN and admin session', async () => {
    vi.stubEnv('METRICS_TOKEN', '')
    mockVerifySession.mockResolvedValueOnce({ role: 'admin', sub: 'u1', tenantId: 't1', exp: 9999999999, iat: 0 })
    const req = new NextRequest('http://localhost/api/metrics/prometheus', {
      headers: { cookie: 'session=tok' },
    })
    const res = await prometheusGET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const body = await res.text()
    expect(body).toContain('requests_total')
  })

  it('returns 401 when METRICS_TOKEN set but wrong Bearer', async () => {
    vi.stubEnv('METRICS_TOKEN', 'secret-metrics-token')
    const req = makeReq('http://localhost/api/metrics/prometheus', {
      authorization: 'Bearer wrong-token',
    })
    const res = await prometheusGET(req)
    expect(res.status).toBe(401)
  })

  it('returns Prometheus text when METRICS_TOKEN matches Bearer', async () => {
    vi.stubEnv('METRICS_TOKEN', 'secret-metrics-token')
    const req = makeReq('http://localhost/api/metrics/prometheus', {
      authorization: 'Bearer secret-metrics-token',
    })
    const res = await prometheusGET(req)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('requests_total')
    expect(mockGeneratePrometheus).toHaveBeenCalledOnce()
  })

  it('returns 401 when Bearer token has different length', async () => {
    vi.stubEnv('METRICS_TOKEN', 'abc')
    const req = makeReq('http://localhost/api/metrics/prometheus', {
      authorization: 'Bearer abcdefg',
    })
    const res = await prometheusGET(req)
    expect(res.status).toBe(401)
  })
})

// ─── GET /api/sse/incidents ───────────────────────────────────────────────────

describe('GET /api/sse/incidents', () => {
  it('returns SSE stream with correct headers', async () => {
    const req = new NextRequest('http://localhost/api/sse/incidents')
    const res = await incidentSSEGET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(res.headers.get('connection')).toBe('keep-alive')
  })

  it('registers SSE handler with tenant ID', async () => {
    const req = new NextRequest('http://localhost/api/sse/incidents')
    await incidentSSEGET(req)
    expect(mockRegisterSSE).toHaveBeenCalledWith('t1', expect.anything())
  })

  it('unregisters handler on cancel', async () => {
    const mockUnregister = vi.fn()
    mockRegisterSSE.mockReturnValueOnce(mockUnregister)
    const req = new NextRequest('http://localhost/api/sse/incidents')
    const res = await incidentSSEGET(req)
    await (res.body as ReadableStream).cancel()
    expect(mockUnregister).toHaveBeenCalled()
  })
})
