import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadShedder, shedResponse } from '../loadShedder'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn(), gauge: vi.fn() },
}))

beforeEach(() => { loadShedder.reset() })

describe('shedResponse', () => {
  it('returns HTTP 503', () => {
    const res = shedResponse()
    expect(res.status).toBe(503)
  })

  it('includes Retry-After header', () => {
    const res = shedResponse()
    expect(res.headers.get('Retry-After')).toBe('5')
  })

  it('includes X-Load-Shed header', () => {
    const res = shedResponse()
    expect(res.headers.get('X-Load-Shed')).toBe('1')
  })

  it('content-type is application/json', () => {
    const res = shedResponse()
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })

  it('body contains error message', async () => {
    const res  = shedResponse()
    const body = await res.json() as { error: string }
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })
})

describe('wrap — throttle path', () => {
  it('returns result even when throttled (above normalThreshold)', async () => {
    const normal = 50
    for (let i = 0; i < normal; i++) loadShedder.acquire()

    const result = await loadShedder.wrap(async () => 'throttled-ok')
    expect(result).toBe('throttled-ok')

    for (let i = 0; i <= normal; i++) loadShedder.release()
  })

  it('returns null when shed (at maxConcurrent)', async () => {
    const max = 200
    for (let i = 0; i < max; i++) loadShedder.acquire()
    const result = await loadShedder.wrap(async () => 'should-not-run')
    expect(result).toBeNull()
    for (let i = 0; i < max; i++) loadShedder.release()
  })
})
