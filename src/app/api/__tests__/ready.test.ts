import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const queryRaw = vi.hoisted(() => vi.fn())
const ping = vi.hoisted(() => vi.fn())
const getRedisClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ default: { $queryRaw: queryRaw } }))
vi.mock('@/lib/redisClient', () => ({ getRedisClient }))

import { GET } from '@/app/api/ready/route'

describe('GET /api/ready — only the database gates readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.USE_MOCK_DATA = 'false'
    process.env.REDIS_URL = 'redis://x'
    getRedisClient.mockResolvedValue({ ping })
  })
  afterEach(() => { delete process.env.USE_MOCK_DATA; delete process.env.REDIS_URL; vi.useRealTimers() })

  it('ready when DB and Redis answer', async () => {
    queryRaw.mockResolvedValue([1]); ping.mockResolvedValue('PONG')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', checks: { db: 'ok', redis: 'ok' } })
  })

  it('stays ready (200) when Redis is down — degraded, not an outage', async () => {
    queryRaw.mockResolvedValue([1]); ping.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).checks.redis).toBe('degraded')
  })

  it('503 when the database is down', async () => {
    queryRaw.mockRejectedValue(new Error('down')); ping.mockResolvedValue('PONG')
    expect((await GET()).status).toBe(503)
  })

  it('answers within the timeout when the database hangs', async () => {
    vi.useFakeTimers()
    queryRaw.mockReturnValue(new Promise(() => {})); ping.mockResolvedValue('PONG')
    const pending = GET()
    await vi.advanceTimersByTimeAsync(3100)
    expect((await pending).status).toBe(503)
  })
})
