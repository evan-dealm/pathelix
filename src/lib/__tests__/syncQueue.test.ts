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

  it('increments retryCount on 4xx (non-422) and continues to next action — regression: no infinite queue loop', async () => {
    const a1 = { id: 'sync-q:1', url: '/a', body: {}, timestamp: 1, retryCount: 0 }
    const a2 = { id: 'sync-q:2', url: '/b', body: {}, timestamp: 2, retryCount: 0 }
    mockIdb.keys.mockResolvedValue(['sync-q:1', 'sync-q:2'])
    mockIdb.get.mockResolvedValueOnce(a1).mockResolvedValueOnce(a2)
    mockIdb.set.mockResolvedValue(undefined)
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 }).mockResolvedValueOnce({ ok: true, status: 200 })

    const count = await flushSyncQueue()
    expect(count).toBe(1)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockIdb.set).toHaveBeenCalledWith('sync-q:1', expect.objectContaining({ retryCount: 1 }))
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

describe('flushSyncQueue — advanced scenarios', () => {
  it('prevents concurrent flushes — second call returns 0 immediately', async () => {
    const action = { id: 'sync-q:1', url: '/api/test', body: {}, timestamp: 1, retryCount: 0 }
    mockIdb.keys.mockResolvedValue(['sync-q:1'])
    mockIdb.get.mockResolvedValue(action)
    mockIdb.del.mockResolvedValue(undefined)
    mockFetch.mockResolvedValue({ ok: true, status: 200 })

    const first = flushSyncQueue()         // sets lock, yields at first await
    const second = await flushSyncQueue()  // lock held → returns 0
    expect(second).toBe(0)
    await first
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('deletes exhausted-retry actions without fetching (MAX_RETRIES = 5)', async () => {
    const exhausted = { id: 'sync-q:1', url: '/api/test', body: {}, timestamp: 1, retryCount: 5 }
    mockIdb.keys.mockResolvedValue(['sync-q:1'])
    mockIdb.get.mockResolvedValue(exhausted)
    mockIdb.del.mockResolvedValue(undefined)

    const count = await flushSyncQueue()
    expect(count).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockIdb.del).toHaveBeenCalledWith('sync-q:1')
  })

  it('partial sync: first succeeds, second errors — stops and increments retryCount', async () => {
    const a1 = { id: 'sync-q:1', url: '/a', body: {}, timestamp: 1, retryCount: 0 }
    const a2 = { id: 'sync-q:2', url: '/b', body: {}, timestamp: 2, retryCount: 0 }
    mockIdb.keys.mockResolvedValue(['sync-q:1', 'sync-q:2'])
    mockIdb.get.mockResolvedValueOnce(a1).mockResolvedValueOnce(a2)
    mockIdb.del.mockResolvedValue(undefined)
    mockIdb.set.mockResolvedValue(undefined)
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockRejectedValueOnce(new Error('Network fail'))

    const count = await flushSyncQueue()
    expect(count).toBe(1)
    expect(mockIdb.del).toHaveBeenCalledWith('sync-q:1')
    expect(mockIdb.del).not.toHaveBeenCalledWith('sync-q:2')
    expect(mockIdb.set).toHaveBeenCalledWith('sync-q:2', expect.objectContaining({ retryCount: 1 }))
  })

  it('increments retryCount on 5xx response', async () => {
    const action = { id: 'sync-q:1', url: '/a', body: {}, timestamp: 1, retryCount: 2 }
    mockIdb.keys.mockResolvedValue(['sync-q:1'])
    mockIdb.get.mockResolvedValue(action)
    mockIdb.set.mockResolvedValue(undefined)
    mockFetch.mockResolvedValue({ ok: false, status: 503 })

    await flushSyncQueue()
    expect(mockIdb.set).toHaveBeenCalledWith('sync-q:1', expect.objectContaining({ retryCount: 3 }))
  })

  it('flushes actions in chronological timestamp order', async () => {
    const late  = { id: 'sync-q:1', url: '/late',  body: {}, timestamp: 200, retryCount: 0 }
    const early = { id: 'sync-q:2', url: '/early', body: {}, timestamp: 50,  retryCount: 0 }
    mockIdb.keys.mockResolvedValue(['sync-q:1', 'sync-q:2'])
    mockIdb.get.mockResolvedValueOnce(late).mockResolvedValueOnce(early)
    mockIdb.del.mockResolvedValue(undefined)
    mockFetch.mockResolvedValue({ ok: true, status: 200 })

    await flushSyncQueue()
    expect(mockFetch.mock.calls[0][0]).toBe('/early')
    expect(mockFetch.mock.calls[1][0]).toBe('/late')
  })
})

describe('photo offline queue', () => {
  it('enqueueAction stores photo dataUrl with correct structure', async () => {
    mockIdb.set.mockResolvedValue(undefined)
    const dataUrl = 'data:image/jpeg;base64,/9j/abc123'
    await enqueueAction('/api/driver-photos', { driverId: 'd1', date: '2026-06-19', missionId: 'm1', dataUrl })
    expect(mockIdb.set).toHaveBeenCalledWith(
      expect.stringMatching(/^sync-q:/),
      expect.objectContaining({
        url: '/api/driver-photos',
        body: expect.objectContaining({ driverId: 'd1', missionId: 'm1', dataUrl }),
      })
    )
  })

  it('getQueuedActions returns photo actions correctly', async () => {
    const photoAction = {
      id: 'sync-q:photo-1', url: '/api/driver-photos',
      body: { driverId: 'd1', date: '2026-06-19', missionId: 'm1', dataUrl: 'data:image/jpeg;base64,abc' },
      timestamp: 100, retryCount: 0,
    }
    mockIdb.keys.mockResolvedValue(['sync-q:photo-1'])
    mockIdb.get.mockResolvedValue(photoAction)
    const actions = await getQueuedActions()
    expect(actions).toHaveLength(1)
    expect(actions[0].body.dataUrl).toBe('data:image/jpeg;base64,abc')
  })

  it('flushSyncQueue replays photo action to server', async () => {
    const photoAction = {
      id: 'sync-q:photo-1', url: '/api/driver-photos',
      body: { driverId: 'd1', date: '2026-06-19', missionId: 'm1', dataUrl: 'data:image/jpeg;base64,abc' },
      timestamp: 100, retryCount: 0,
    }
    mockIdb.keys.mockResolvedValue(['sync-q:photo-1'])
    mockIdb.get.mockResolvedValue(photoAction)
    mockIdb.del.mockResolvedValue(undefined)
    mockFetch.mockResolvedValue({ ok: true, status: 200 })

    const count = await flushSyncQueue()
    expect(count).toBe(1)
    expect(mockFetch).toHaveBeenCalledWith('/api/driver-photos', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('data:image/jpeg'),
    }))
    expect(mockIdb.del).toHaveBeenCalledWith('sync-q:photo-1')
  })

  it('signature action (missionId ending _sig) is also queued and flushed', async () => {
    const sigAction = {
      id: 'sync-q:sig-1', url: '/api/driver-photos',
      body: { driverId: 'd1', date: '2026-06-19', missionId: 'm1_sig', dataUrl: 'data:image/png;base64,abc' },
      timestamp: 200, retryCount: 0,
    }
    mockIdb.keys.mockResolvedValue(['sync-q:sig-1'])
    mockIdb.get.mockResolvedValue(sigAction)
    mockIdb.del.mockResolvedValue(undefined)
    mockFetch.mockResolvedValue({ ok: true, status: 200 })

    const count = await flushSyncQueue()
    expect(count).toBe(1)
    expect(mockIdb.del).toHaveBeenCalledWith('sync-q:sig-1')
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
