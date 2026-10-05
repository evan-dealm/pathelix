import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory IndexedDB (idb-keyval) so the queue's real read/modify/write logic is exercised.
const store = vi.hoisted(() => new Map<string, unknown>())
vi.mock('idb-keyval', () => ({
  get:  vi.fn(async (k: string) => store.get(k)),
  set:  vi.fn(async (k: string, v: unknown) => { store.set(k, structuredClone(v)) }),
  del:  vi.fn(async (k: string) => { store.delete(k) }),
  keys: vi.fn(async () => [...store.keys()]),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  enqueueAction, flushSyncQueue, getQueueStatus, getQueuedActions, getSyncQueueSize,
  retryFailedAction, discardAction, backoffDelay, cacheDayPlan, getCachedDayPlan,
  clearDriverDeviceData, sendNow, type QueuedAction,
} from '@/lib/syncQueue'

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function onlyAction(): Promise<QueuedAction> {
  const actions = await getQueuedActions()
  expect(actions).toHaveLength(1)
  return actions[0]
}

beforeEach(() => {
  store.clear()
  mockFetch.mockReset()
  vi.useRealTimers()
})

describe('enqueueAction', () => {
  it('stores the action with a UUID-based key that is reused as Idempotency-Key on every retry', async () => {
    const id = await enqueueAction('/api/driver-status/update', { status: 'done' }, { ownerId: 'd1', label: 'Statut' })
    expect(id).toMatch(/^sync-q:\d+-[0-9a-f-]{36}$/)
    mockFetch.mockResolvedValue(json(503))
    await flushSyncQueue()
    // Force the backoff to be due and retry.
    const a = await onlyAction()
    store.set(a.id, { ...a, nextAttemptAt: 0 })
    await flushSyncQueue()
    const keys = mockFetch.mock.calls.map(c => (c[1] as RequestInit).headers as Record<string, string>).map(h => h['Idempotency-Key'])
    expect(keys).toEqual([id, id])
  })
})

describe('flushSyncQueue', () => {
  it('deletes delivered actions', async () => {
    await enqueueAction('/api/x', { a: 1 })
    mockFetch.mockResolvedValue(json(200))
    const r = await flushSyncQueue()
    expect(r).toMatchObject({ synced: 1, pending: 0, failed: 0, authRequired: false })
    expect(await getSyncQueueSize()).toBe(0)
  })

  it('never drops an action on network errors or 5xx — retries with backoff', async () => {
    await enqueueAction('/api/x', { a: 1 })
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    for (let i = 0; i < 20; i++) {
      const a = await onlyAction()
      store.set(a.id, { ...a, nextAttemptAt: 0 })
      await flushSyncQueue()
    }
    const a = await onlyAction()
    expect(a.state).toBe('pending')
    expect(a.retryCount).toBe(20)
    expect(a.nextAttemptAt).toBeGreaterThan(Date.now())
  })

  it('respects the backoff and keeps order: a due later action does not overtake a waiting head', async () => {
    await enqueueAction('/api/first', {})
    await new Promise(r => setTimeout(r, 2))
    await enqueueAction('/api/second', {})
    mockFetch.mockResolvedValueOnce(json(503))
    await flushSyncQueue()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    mockFetch.mockClear()
    await flushSyncQueue() // head not due yet
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('pauses on 401 (session expired) without counting a retry or dropping anything', async () => {
    await enqueueAction('/api/x', {})
    await enqueueAction('/api/y', {})
    mockFetch.mockResolvedValue(json(401))
    const r = await flushSyncQueue()
    expect(r.authRequired).toBe(true)
    expect(r.pending).toBe(2)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect((await getQueuedActions())[0].retryCount).toBe(0)
  })

  it('moves a rejected action (4xx) to a visible failed state with the server message, and continues', async () => {
    await enqueueAction('/api/bad', {}, { label: 'Statut' })
    await new Promise(r => setTimeout(r, 2))
    await enqueueAction('/api/good', {})
    mockFetch
      .mockResolvedValueOnce(json(404, { error: 'Mission absente de votre tournée' }))
      .mockResolvedValueOnce(json(200))
    const r = await flushSyncQueue()
    expect(r).toMatchObject({ synced: 1, pending: 0, failed: 1 })
    const status = await getQueueStatus()
    expect(status.failed[0]).toMatchObject({ state: 'failed', lastStatus: 404, lastError: 'Mission absente de votre tournée', label: 'Statut' })
  })

  it('treats 422 as a failure to show, not as a success (it used to be silently deleted)', async () => {
    await enqueueAction('/api/x', {})
    mockFetch.mockResolvedValue(json(422, { error: 'Données invalides' }))
    const r = await flushSyncQueue()
    expect(r.synced).toBe(0)
    expect(r.failed).toBe(1)
  })

  it('retries (does not fail) on 409 — the same action is still running server-side', async () => {
    await enqueueAction('/api/x', {})
    mockFetch.mockResolvedValue(json(409))
    await flushSyncQueue()
    expect((await onlyAction()).state).toBe('pending')
  })

  it('skips failed actions and actions recorded for another driver', async () => {
    await enqueueAction('/api/mine', {}, { ownerId: 'd1' })
    await enqueueAction('/api/other', {}, { ownerId: 'd2' })
    mockFetch.mockResolvedValue(json(200))
    await flushSyncQueue('d1')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/mine')
  })

  it('sends DELETE actions with their parameters in the query string', async () => {
    await enqueueAction('/api/driver-photos', { driverId: 'd1', date: '2026-01-01', missionId: 'm1' }, { method: 'DELETE' })
    mockFetch.mockResolvedValue(json(200))
    await flushSyncQueue()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/driver-photos?driverId=d1&date=2026-01-01&missionId=m1')
    expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBe('DELETE')
  })

  it('serializes concurrent flushes through the shared Web Lock (no double delivery)', async () => {
    let held = Promise.resolve()
    const locks = {
      request: vi.fn((_name: string, cb: () => Promise<unknown>) => {
        const run = held.then(cb)
        held = run.then(() => undefined, () => undefined)
        return run
      }),
    }
    Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true })
    try {
      await enqueueAction('/api/x', {})
      mockFetch.mockImplementation(async () => { await new Promise(r => setTimeout(r, 5)); return json(200) })
      await Promise.all([flushSyncQueue(), flushSyncQueue()])
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(locks.request).toHaveBeenCalledWith('pathelix-offline-sync-queue', expect.any(Function))
    } finally {
      Object.defineProperty(globalThis.navigator, 'locks', { value: undefined, configurable: true })
    }
  })
})

describe('failed actions', () => {
  it('can be retried or discarded by the driver', async () => {
    await enqueueAction('/api/x', {})
    mockFetch.mockResolvedValueOnce(json(400, { error: 'x' }))
    await flushSyncQueue()
    const [failed] = (await getQueueStatus()).failed
    await retryFailedAction(failed.id)
    expect((await onlyAction()).state).toBe('pending')
    await discardAction(failed.id)
    expect(await getQueuedActions()).toHaveLength(0)
  })
})

describe('backoffDelay', () => {
  it('grows exponentially and is capped at 10 minutes', () => {
    expect(backoffDelay(1)).toBe(5_000)
    expect(backoffDelay(2)).toBe(10_000)
    expect(backoffDelay(3)).toBe(20_000)
    expect(backoffDelay(50)).toBe(600_000)
  })
})

describe('sendNow (IndexedDB unavailable fallback)', () => {
  it('reports success/failure of a direct delivery', async () => {
    mockFetch.mockResolvedValueOnce(json(200))
    expect(await sendNow('/api/x', {})).toBe(true)
    mockFetch.mockRejectedValueOnce(new TypeError('offline'))
    expect(await sendNow('/api/x', {})).toBe(false)
  })
})

describe('day plan cache', () => {
  it('returns a fresh cached plan and ignores one older than 24h', async () => {
    await cacheDayPlan('d1', '2026-05-10', { plan: [1] })
    expect(await getCachedDayPlan('d1', '2026-05-10')).toEqual({ plan: [1] })
    store.set('plan:d1:2026-05-10', { data: { plan: [1] }, cachedAt: Date.now() - 90_000_000 })
    expect(await getCachedDayPlan('d1', '2026-05-10')).toBeNull()
  })
})

describe('clearDriverDeviceData (logout on a shared device)', () => {
  it('removes cached plans, GPS backlog and queued actions, nothing else', async () => {
    store.set('plan:d1:2026-01-01', {})
    store.set('gps-q:1', {})
    store.set('sync-q:1-x', {})
    store.set('unrelated', {})
    await clearDriverDeviceData()
    expect([...store.keys()]).toEqual(['unrelated'])
  })
})
