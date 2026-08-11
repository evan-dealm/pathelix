import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  default: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) },
}))

vi.mock('@/lib/redisClient', () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/status/route'

describe('GET /api/status', () => {
  it('returns 200 with status field', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(['operational', 'degraded', 'outage']).toContain(body.status)
  })

  it('returns SLA target of 99.5%', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.sla).toBeDefined()
    expect(body.sla.target).toBe('99.5%')
  })

  it('returns services array with at least one entry', async () => {
    const res = await GET()
    const body = await res.json()
    expect(Array.isArray(body.services)).toBe(true)
    expect(body.services.length).toBeGreaterThan(0)
  })

  it('returns ISO timestamp field', async () => {
    const res = await GET()
    const body = await res.json()
    expect(typeof body.timestamp).toBe('string')
    expect(() => new Date(body.timestamp)).not.toThrow()
  })

  it('reports Database operational when prisma responds', async () => {
    const res = await GET()
    const body = await res.json()
    const db = body.services.find((s: { name: string }) => s.name.includes('Database'))
    expect(db).toBeDefined()
    expect(db.status).toBe('operational')
  })

  it('reports Redis degraded (not configured) when client is null', async () => {
    const res = await GET()
    const body = await res.json()
    const redis = body.services.find((s: { name: string }) => s.name.includes('Redis'))
    expect(redis).toBeDefined()
    expect(redis.status).toBe('degraded')
  })
})
