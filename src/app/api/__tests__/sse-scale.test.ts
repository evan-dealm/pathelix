/**
 * Scale tests for GET /api/sse/driver-status
 * Validates that the connection limit supports ≥150 drivers per tenant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/data/context', () => ({
  getTenantId: vi.fn(() => 'tenant-scale'),
}))
vi.mock('@/lib/statusStore', () => ({
  _statusStore:         new Map(),
  getAllStatusesForDate: vi.fn(async () => ({})),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/metrics', () => ({
  metrics:  { increment: vi.fn(), histogram: vi.fn() },
  METRIC:   {},
}))
vi.mock('@/lib/redisClient', () => ({ REDIS_AVAILABLE: false }))

import { GET } from '@/app/api/sse/driver-status/route'
import { getTenantId } from '@/lib/data/context'

function makeSSEReq(date = '2026-06-19'): NextRequest {
  return new NextRequest(`http://localhost/api/sse/driver-status?date=${date}`, {
    headers: { 'x-tenant-id': 'tenant-scale' },
  })
}

describe('SSE driver-status — connection limit (scale)', () => {
  const streams: ReadableStream[] = []

  afterEach(() => {
    // Cancel all open streams to release connection slots
    for (const s of streams) { try { s.cancel() } catch { /* ignore */ } }
    streams.length = 0
  })

  it('150 connexions simultanées ouvrent sans 429', async () => {
    vi.mocked(getTenantId).mockReturnValue('tenant-limit-150')

    const opened: Response[] = []
    for (let i = 0; i < 150; i++) {
      const res = await GET(makeSSEReq())
      if (res.status !== 200) {
        for (const r of opened) { try { r.body?.cancel() } catch { /* ignore */ } }
        throw new Error(`SSE connexion ${i + 1}/150 rejetée (status=${res.status}) — limite trop basse`)
      }
      opened.push(res)
      if (res.body) streams.push(res.body)
    }
    expect(opened).toHaveLength(150)

    for (const r of opened) { try { r.body?.cancel() } catch { /* ignore */ } }
    streams.length = 0
  })

  it('limite SSE ≥ 200 connexions (palier marge)', async () => {
    vi.mocked(getTenantId).mockReturnValue('tenant-limit-200')

    const opened: Response[] = []
    for (let i = 0; i < 200; i++) {
      const res = await GET(makeSSEReq())
      if (res.status === 200 && res.body) {
        opened.push(res)
        streams.push(res.body)
      } else {
        for (const r of opened) { try { r.body?.cancel() } catch { /* ignore */ } }
        throw new Error(`SSE connection limit hit at ${i + 1}/200 (status=${res.status})`)
      }
    }
    expect(opened).toHaveLength(200)

    const overflow = await GET(makeSSEReq())
    expect(overflow.status).toBe(429)

    for (const r of opened) { try { r.body?.cancel() } catch { /* ignore */ } }
    streams.length = 0
  })

  it('décrémenter libère les slots (cancel → reconnect)', async () => {
    vi.mocked(getTenantId).mockReturnValue('tenant-release')

    // Open 5 connections
    const five: Response[] = []
    for (let i = 0; i < 5; i++) {
      const r = await GET(makeSSEReq())
      five.push(r)
      if (r.body) streams.push(r.body)
    }

    // Cancel all (simulates client disconnect)
    for (const r of five) { try { await r.body?.cancel() } catch { /* ignore */ } }
    streams.length = 0

    // Wait a tick for cancel handlers to run
    await new Promise(r => setTimeout(r, 10))

    // Should be able to open 5 new ones
    for (let i = 0; i < 5; i++) {
      const r = await GET(makeSSEReq())
      expect(r.status, `reconnect ${i + 1} after release`).toBe(200)
      if (r.body) { streams.push(r.body); r.body.cancel().catch(() => {}) }
    }
  })

  it('429 contient JSON avec champ error', async () => {
    vi.mocked(getTenantId).mockReturnValue('tenant-429')

    // Fill to limit
    const limit = parseInt(process.env.SSE_MAX_CONNECTIONS_PER_TENANT ?? '200', 10)
    const open: Response[] = []
    for (let i = 0; i < limit; i++) {
      const r = await GET(makeSSEReq())
      open.push(r)
      if (r.body) streams.push(r.body)
    }

    const overflow = await GET(makeSSEReq())
    expect(overflow.status).toBe(429)
    const body = await overflow.json()
    expect(body).toHaveProperty('error')

    for (const r of open) { try { r.body?.cancel() } catch { /* ignore */ } }
    streams.length = 0
  })
})
