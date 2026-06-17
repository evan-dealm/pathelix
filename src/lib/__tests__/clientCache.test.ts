import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cachedFetch, invalidateClientCache, invalidateClientCachePattern } from '../clientCache'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeRes(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(data),
  } as Response)
}

beforeEach(() => {
  mockFetch.mockReset()
  invalidateClientCachePattern('')
})

describe('cachedFetch', () => {
  it('first call fetches from network', async () => {
    mockFetch.mockReturnValueOnce(makeRes({ items: [1, 2, 3] }))

    const result = await cachedFetch<{ items: number[] }>('/api/test-first')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ items: [1, 2, 3] })
  })

  it('second call within TTL returns cached without network call', async () => {
    mockFetch.mockReturnValue(makeRes({ data: 'fresh' }))

    await cachedFetch('/api/settings-cached', 30_000)
    await cachedFetch('/api/settings-cached', 30_000)

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('two concurrent calls for same URL make only one network request', async () => {
    let resolveFetch!: (v: Response) => void
    const controlled = new Promise<Response>(r => { resolveFetch = r })
    mockFetch.mockReturnValue(controlled)

    const p1 = cachedFetch<{ x: number }>('/api/concurrent')
    const p2 = cachedFetch<{ x: number }>('/api/concurrent')

    resolveFetch({ ok: true, status: 200, json: () => Promise.resolve({ x: 42 }) } as Response)

    const [a, b] = await Promise.all([p1, p2])

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(a).toEqual({ x: 42 })
    expect(b).toEqual({ x: 42 })
  })

  it('after TTL expires fetches again', async () => {
    vi.useFakeTimers()
    try {
      mockFetch.mockReturnValue(makeRes({ v: 1 }))
      await cachedFetch('/api/ttl-test', 1_000)

      vi.advanceTimersByTime(2_000)

      mockFetch.mockReturnValue(makeRes({ v: 2 }))
      const result = await cachedFetch<{ v: number }>('/api/ttl-test', 1_000)

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ v: 2 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('invalidateClientCache removes the entry', async () => {
    mockFetch.mockReturnValue(makeRes({ cached: true }))
    await cachedFetch('/api/to-invalidate', 60_000)

    invalidateClientCache('/api/to-invalidate')

    mockFetch.mockReturnValue(makeRes({ cached: false }))
    const result = await cachedFetch<{ cached: boolean }>('/api/to-invalidate', 60_000)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ cached: false })
  })

  it('network error is not cached, next call fetches again', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    await expect(cachedFetch('/api/error-test', 60_000)).rejects.toThrow()

    mockFetch.mockReturnValueOnce(makeRes({ recovered: true }))
    const result = await cachedFetch<{ recovered: boolean }>('/api/error-test', 60_000)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ recovered: true })
  })
})
