import { describe, it, expect, vi, beforeEach } from 'vitest'

// Provide navigator mock for node environment
vi.hoisted(() => {
  if (!('navigator' in globalThis)) {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          controller: null,
          ready: Promise.resolve({ sync: null }),
        },
      },
      writable:     true,
      configurable: true,
    })
  }
})

const mockIdb = vi.hoisted(() => ({
  get:  vi.fn(),
  set:  vi.fn(),
  del:  vi.fn(),
  keys: vi.fn(),
}))

vi.mock('idb-keyval', () => ({
  get:  mockIdb.get,
  set:  mockIdb.set,
  del:  mockIdb.del,
  keys: mockIdb.keys,
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  enqueueAction,
  getSyncQueueSize,
  getQueuedActions,
  flushSyncQueue,
  cacheDayPlan,
  getCachedDayPlan,
} from '@/lib/syncQueue'

beforeEach(() => {
  vi.clearAllMocks()
  mockIdb.keys.mockResolvedValue([])
})

describe('enqueueAction', () => {
  it('calls idb set with a prefixed key and action object', async () => {
    mockIdb.set.mockResolvedValue(undefined)
    await enqueueAction('/api/missions', { type: 'POSER' })
    expect(mockIdb.set).toHaveBeenCalledWith(
      expect.stringMatching(/^sync-q:/),
      expect.objectContaining({
        url:  '/api/missions',
        body: { type: 'POSER' },
      }),
    )
  })
})

describe('getSyncQueueSize', () => {
  it('returns 0 when no queued keys', async () => {
    mockIdb.keys.mockResolvedValue(['other:key', 'plan:d1:2026-05-10'])
    expect(await getSyncQueueSize()).toBe(0)
  })

  it('counts only sync-q: prefixed keys', async () => {
    mockIdb.keys.mockResolvedValue(['sync-q:1', 'sync-q:2', 'other:x'])
    expect(await getSyncQueueSize()).toBe(2)
  })
})

describe('getQueuedActions', () => {
  it('returns sorted actions by timestamp', async () => {
    const a1 = { id: 'sync-q:1', url: '/a', body: {}, timestamp: 100 }
    const a2 = { id: 'sync-q:2', url: '/b', body: {}, timestamp: 50 }
    mockIdb.keys.mockResolvedValue(['sync-q:1', 'sync-q:2'])
    mockIdb.get.mockResolvedValueOnce(a1).mockResolvedValueOnce(a2)
    const actions = await getQueuedActions()
    expect(actions[0].timestamp).toBe(50)
    expect(actions[1].timestamp).toBe(100)
  })

  it('skips entries that get returns null for', async () => {
    mockIdb.keys.mockResolvedValue(['sync-q:1'])
    mockIdb.get.mockResolvedValue(null)
    const actions = await getQueuedActions()
    expect(actions).toHaveLength(0)
  })
})

describe('flushSyncQueue', () => {
  it('POSTs each action and deletes on success', async () => {
    const action = { id: 'sync-q:1', url: '/api/test', body: { x: 1 }, timestamp: 1 }
    mockIdb.keys.mockResolvedValue(['sync-q:1'])
    mockIdb.get.mockResolvedValue(action)
    mockIdb.del.mockResolvedValue(undefined)
    mockFetch.mockResolvedValue({ ok: true, status: 200 })

    const count = await flushSyncQueue()
    expect(count).toBe(1)
    expect(mockIdb.del).toHaveBeenCalledWith('sync-q:1')
  })

  it('treats 422 as success (deletes entry)', async () => {
    const action = { id: 'sync-q:1', url: '/api/test', body: {}, timestamp: 1 }
    mockIdb.keys.mockResolvedValue(['sync-q:1'])
    mockIdb.get.mockResolvedValue(action)
    mockIdb.del.mockResolvedValue(undefined)
    mockFetch.mockResolvedValue({ ok: false, status: 422 })

    const count = await flushSyncQueue()
    expect(count).toBe(1)
  })

  it('stops processing on 5xx server error', async () => {
    const a1 = { id: 'sync-q:1', url: '/a', body: {}, timestamp: 1 }
    const a2 = { id: 'sync-q:2', url: '/b', body: {}, timestamp: 2 }
    mockIdb.keys.mockResolvedValue(['sync-q:1', 'sync-q:2'])
    mockIdb.get.mockResolvedValueOnce(a1).mockResolvedValueOnce(a2)
    mockFetch.mockResolvedValue({ ok: false, status: 500 })

    const count = await flushSyncQueue()
    expect(count).toBe(0)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('stops processing on network error', async () => {
    const action = { id: 'sync-q:1', url: '/a', body: {}, timestamp: 1 }
    mockIdb.keys.mockResolvedValue(['sync-q:1'])
    mockIdb.get.mockResolvedValue(action)
    mockFetch.mockRejectedValue(new Error('Offline'))

    const count = await flushSyncQueue()
    expect(count).toBe(0)
  })
})

describe('cacheDayPlan / getCachedDayPlan', () => {
  it('set then get returns the cached plan', async () => {
    const data = { missions: [{ id: 'm-1' }] }
    mockIdb.set.mockResolvedValue(undefined)
    mockIdb.get.mockResolvedValue({ data, cachedAt: Date.now() })

    await cacheDayPlan('d-1', '2026-05-10', data)
    const result = await getCachedDayPlan('d-1', '2026-05-10')
    expect(result).toEqual(data)
  })

  it('returns null when cached plan is older than 24h', async () => {
    mockIdb.get.mockResolvedValue({
      data:     { missions: [] },
      cachedAt: Date.now() - 90_000_000,  // 25h ago
    })
    const result = await getCachedDayPlan('d-1', '2026-05-10')
    expect(result).toBeNull()
  })

  it('returns null when no cache entry', async () => {
    mockIdb.get.mockResolvedValue(null)
    expect(await getCachedDayPlan('d-1', '2026-05-10')).toBeNull()
  })
})
