import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStatusHub, type StatusHubDeps } from '../driverStatusHub'
import type { StatusSnapshot } from '../driverStatusSnapshot'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

type Handler = (..._args: string[]) => void

/** Minimal stand-in for an ioredis subscriber. */
function fakeRedis() {
  const handlers = new Map<string, Handler[]>()
  const channels = new Set<string>()
  const state = { failSubscribe: false, created: 0 }
  function emit(event: string, ...args: string[]) {
    for (const h of handlers.get(event) ?? []) h(...args)
  }
  const sub = {
    subscribe: vi.fn(async (channel: string) => {
      if (state.failSubscribe) throw new Error('Connection is closed')
      channels.add(channel)
      emit('ready')
    }),
    unsubscribe: vi.fn(async (channel: string) => {
      channels.delete(channel)
    }),
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    disconnect: vi.fn(),
  }
  return {
    sub,
    channels,
    state,
    emit,
    publish: (channel: string) => {
      if (channels.has(channel)) emit('message', channel, '{}')
    },
  }
}

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const snap = (value: Record<string, Record<string, string>>) => value as unknown as StatusSnapshot
const CHANNEL = 'driver-status:t1:2026-10-08'

describe('driver status hub', () => {
  let snapshot: StatusSnapshot
  let loads: Array<{ tenantId: string; date: string }>
  let redis: ReturnType<typeof fakeRedis>
  let deps: StatusHubDeps

  beforeEach(() => {
    snapshot = snap({ d1: { m1: 'en_route' } })
    loads = []
    redis = fakeRedis()
    deps = {
      loadSnapshot: async (tenantId, date) => {
        loads.push({ tenantId, date })
        await tick(2)
        return JSON.parse(JSON.stringify(snapshot))
      },
      createSubscriber: async () => {
        redis.state.created++
        return redis.sub as never
      },
      minGapMs: 20,
      pollMs: 40,
    }
  })

  it('opens one Redis subscriber and reads the snapshot once per change, whatever the number of screens', async () => {
    const hub = createStatusHub(deps)
    const frames: string[][] = Array.from({ length: 50 }, () => [])
    const offs = await Promise.all(
      frames.map(f => hub.subscribe('t1', '2026-10-08', json => f.push(json))),
    )
    await tick(30)

    expect(redis.state.created).toBe(1)
    expect(redis.sub.subscribe).toHaveBeenCalledTimes(1)
    // Every screen got the current snapshot exactly once.
    for (const f of frames) expect(f).toEqual([JSON.stringify(snapshot)])
    const initialLoads = loads.length
    expect(initialLoads).toBeLessThanOrEqual(3) // not 50

    snapshot = snap({ d1: { m1: 'done' } })
    redis.publish(CHANNEL)
    await tick(60)
    expect(loads.length - initialLoads).toBe(1) // one read for 50 screens
    for (const f of frames) {
      expect(f).toHaveLength(2)
      expect(f[1]).toBe(JSON.stringify(snapshot))
    }

    for (const off of offs) off()
    expect(hub.stats()).toMatchObject({ topics: 0, listeners: 0 })
    expect(redis.sub.unsubscribe).toHaveBeenCalledWith(CHANNEL)
    hub.close()
  })

  it('folds a burst of changes into the reads that follow it', async () => {
    const hub = createStatusHub(deps)
    const frames: string[] = []
    const off = await hub.subscribe('t1', '2026-10-08', json => frames.push(json))
    await tick(30)
    const before = loads.length
    for (let i = 0; i < 40; i++) {
      snapshot = snap({ d1: { m1: i % 2 ? 'done' : 'en_route', ['m' + i]: 'done' } })
      redis.publish(CHANNEL)
    }
    await tick(120)
    expect(loads.length - before).toBeLessThanOrEqual(3)
    // The last state always reaches the screen.
    expect(frames[frames.length - 1]).toBe(JSON.stringify(snapshot))
    off()
    hub.close()
  })

  it('never sends one organisation the snapshot of another', async () => {
    const perTenant: Record<string, StatusSnapshot> = {
      a: snap({ da: { ma: 'done' } }),
      b: snap({ db: { mb: 'en_route' } }),
    }
    const hub = createStatusHub({ ...deps, loadSnapshot: async tenantId => perTenant[tenantId] })
    const a: string[] = [],
      b: string[] = []
    const offA = await hub.subscribe('a', '2026-10-08', j => a.push(j))
    const offB = await hub.subscribe('b', '2026-10-08', j => b.push(j))
    await tick(30)
    perTenant.a = snap({ da: { ma: 'done', ma2: 'done' } })
    redis.publish('driver-status:a:2026-10-08')
    await tick(60)
    expect(a.every(j => !j.includes('db'))).toBe(true)
    expect(b).toEqual([JSON.stringify(perTenant.b)]) // nothing new for b
    expect(a[a.length - 1]).toContain('ma2')
    offA()
    offB()
    hub.close()
  })

  it('polls the database, once per topic, when Redis is not configured', async () => {
    const hub = createStatusHub({ ...deps, createSubscriber: async () => null })
    const frames: string[][] = [[], [], []]
    const offs = await Promise.all(
      frames.map(f => hub.subscribe('t1', '2026-10-08', j => f.push(j))),
    )
    await tick(20)
    const before = loads.length
    snapshot = snap({ d1: { m1: 'done' } })
    await tick(130)
    expect(hub.stats().polling).toBe(1)
    expect(loads.length - before).toBeGreaterThanOrEqual(2)
    expect(loads.length - before).toBeLessThanOrEqual(5) // ~3 polls for 3 screens, not 9
    for (const f of frames) expect(f[f.length - 1]).toBe(JSON.stringify(snapshot))
    offs.forEach(off => off())
    await tick(60)
    const settled = loads.length
    await tick(100)
    expect(loads.length).toBe(settled) // no timer left behind
    hub.close()
  })

  it('falls back to polling while Redis is down and catches up when it is back', async () => {
    const hub = createStatusHub(deps)
    const frames: string[] = []
    const off = await hub.subscribe('t1', '2026-10-08', j => frames.push(j))
    await tick(30)
    expect(hub.stats()).toMatchObject({ redisSubscribed: true, polling: 0 })

    redis.emit('close')
    expect(hub.stats()).toMatchObject({ redisSubscribed: false, polling: 1 })
    snapshot = snap({ d1: { m1: 'done' } })
    await tick(90)
    expect(frames[frames.length - 1]).toBe(JSON.stringify(snapshot)) // delivered by polling

    snapshot = snap({ d1: { m1: 'done', m2: 'done' } })
    redis.emit('ready')
    await tick(40)
    expect(hub.stats()).toMatchObject({ redisSubscribed: true, polling: 0 })
    expect(frames[frames.length - 1]).toBe(JSON.stringify(snapshot)) // re-read on reconnection
    off()
    hub.close()
  })

  it('subscribes again a view opened while Redis was away', async () => {
    redis.state.failSubscribe = true
    const hub = createStatusHub(deps)
    const frames: string[] = []
    const off = await hub.subscribe('t1', '2026-10-08', j => frames.push(j))
    await tick(20)
    expect(frames).toHaveLength(1) // the view works from the start
    expect(hub.stats().polling).toBe(1)

    redis.state.failSubscribe = false
    redis.emit('ready')
    await tick(20)
    expect(redis.channels.has(CHANNEL)).toBe(true)
    expect(hub.stats()).toMatchObject({ redisSubscribed: true, polling: 0 })
    off()
    hub.close()
  })

  it('a view closed right after opening leaves nothing behind', async () => {
    const hub = createStatusHub(deps)
    const off = await hub.subscribe('t1', '2026-10-08', () => {})
    off()
    off() // idempotent
    await tick(30)
    expect(hub.stats()).toMatchObject({ topics: 0, listeners: 0, polling: 0 })
    hub.close()
  })

  it('keeps serving the other screens when one of them throws', async () => {
    const hub = createStatusHub(deps)
    const good: string[] = []
    const offBad = await hub.subscribe('t1', '2026-10-08', () => {
      throw new Error('stream closed')
    })
    const offGood = await hub.subscribe('t1', '2026-10-08', j => good.push(j))
    snapshot = snap({ d1: { m1: 'done' } })
    redis.publish(CHANNEL)
    await tick(60)
    expect(good[good.length - 1]).toBe(JSON.stringify(snapshot))
    offBad()
    offGood()
    hub.close()
  })
})
