import { describe, it, expect, afterEach, vi } from 'vitest'
import { makeInstance } from '../../../../scripts/vrp-bench/instances'
import {
  closeSolverPool,
  configureSolverPool,
  runVRPOffThread,
  solveOffThread,
  solverPoolStatus,
  SolverBusyError,
} from '../solverPool'
import type { Driver, Exutoire, Mission } from '@/lib/types'

/**
 * Real solver threads (no mock): the point of the pool is what happens to the calling thread
 * while a search runs, and that cannot be observed with a fake.
 */

const inst = makeInstance('pool', 40, 4, 11)
const missions = inst.missions as unknown as Mission[]
const drivers = inst.drivers as unknown as Driver[]
const exutoires = inst.exutoires as unknown as Exutoire[]
const OPTS = { seed: 7, defaultStartTime: '07:00', defaultSpeedKmh: 50 }

/** Longest time the event loop of this thread went without running a timer. */
function watchEventLoop() {
  let last = performance.now()
  let worst = 0
  const timer = setInterval(() => {
    const now = performance.now()
    worst = Math.max(worst, now - last - 10)
    last = now
  }, 10)
  return () => {
    clearInterval(timer)
    return worst
  }
}

describe('solver pool', () => {
  afterEach(async () => {
    await closeSolverPool()
    vi.unstubAllEnvs()
  })

  it('runs the search in a thread: the calling event loop keeps running during the whole budget', async () => {
    vi.stubEnv('VALHALLA_URL', '')
    configureSolverPool({ size: 1 })
    // Warm-up: starting the thread (module loading) is not what is measured.
    await runVRPOffThread(missions.slice(0, 5), drivers, exutoires, inst.date, {
      ...OPTS,
      timeBudgetMs: 300,
    })
    expect(solverPoolStatus()).toMatchObject({ threads: 1, inline: false })

    const stop = watchEventLoop()
    const t0 = performance.now()
    const result = await runVRPOffThread(missions, drivers, exutoires, inst.date, {
      ...OPTS,
      timeBudgetMs: 2_000,
    })
    const elapsed = performance.now() - t0
    const worstLag = stop()

    expect(elapsed).toBeGreaterThan(1_500) // the search did use its budget…
    expect(worstLag).toBeLessThan(250) // …and this thread was never held by it
    // Same guarantees as the direct call: every mission accounted for exactly once.
    const planned = Object.values(result.assignments)
      .flat()
      .filter(m => !m.isSynthetic)
      .map(m => m.id)
    const all = [...planned, ...result.unassignedMissions.map(m => m.id)]
    expect(new Set(all).size).toBe(all.length)
    expect(new Set(all)).toEqual(new Set(missions.map(m => m.id)))
  }, 60_000)

  it('the same search run inline holds the event loop (what the pool exists to avoid)', async () => {
    vi.stubEnv('VALHALLA_URL', '')
    configureSolverPool({ size: 0 })
    const stop = watchEventLoop()
    await runVRPOffThread(missions, drivers, exutoires, inst.date, { ...OPTS, timeBudgetMs: 1_500 })
    await new Promise(r => setTimeout(r, 30)) // let the watchdog timer run once after the search
    expect(stop()).toBeGreaterThan(500)
    expect(solverPoolStatus().inline).toBe(true)
  }, 60_000)

  it('runs two searches side by side with two threads', async () => {
    vi.stubEnv('VALHALLA_URL', '')
    configureSolverPool({ size: 2 })
    await Promise.all(
      [0, 1].map(() =>
        runVRPOffThread(missions.slice(0, 5), drivers, exutoires, inst.date, {
          ...OPTS,
          timeBudgetMs: 300,
        }),
      ),
    )
    const t0 = performance.now()
    await Promise.all(
      [0, 1].map(() =>
        runVRPOffThread(missions, drivers, exutoires, inst.date, { ...OPTS, timeBudgetMs: 2_000 }),
      ),
    )
    // Two 2 s searches: ~2 s side by side, ~4 s one after the other.
    expect(performance.now() - t0).toBeLessThan(3_600)
    expect(solverPoolStatus().threads).toBe(2)
  }, 60_000)

  it('refuses work beyond its queue instead of piling it up', async () => {
    vi.stubEnv('VALHALLA_URL', '')
    vi.stubEnv('VRP_SOLVER_QUEUE_MAX', '1')
    configureSolverPool({ size: 1 })
    await runVRPOffThread(missions.slice(0, 5), drivers, exutoires, inst.date, {
      ...OPTS,
      timeBudgetMs: 300,
    })
    const run = () =>
      runVRPOffThread(missions, drivers, exutoires, inst.date, { ...OPTS, timeBudgetMs: 1_000 })
    const first = run() // taken by the thread
    await new Promise(r => setTimeout(r, 50))
    const second = run() // waits in the queue
    await expect(run()).rejects.toBeInstanceOf(SolverBusyError) // queue full
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  }, 60_000)

  it('gives up waiting for a free thread after maxWaitMs', async () => {
    vi.stubEnv('VALHALLA_URL', '')
    configureSolverPool({ size: 1 })
    await runVRPOffThread(missions.slice(0, 5), drivers, exutoires, inst.date, {
      ...OPTS,
      timeBudgetMs: 300,
    })
    const long = runVRPOffThread(missions, drivers, exutoires, inst.date, {
      ...OPTS,
      timeBudgetMs: 1_500,
    })
    await new Promise(r => setTimeout(r, 50))
    await expect(
      solveOffThread(
        {
          op: 'vrp',
          missions,
          drivers,
          exutoires,
          date: inst.date,
          options: { ...OPTS, timeBudgetMs: 500 },
        },
        { maxWaitMs: 200 },
      ),
    ).rejects.toBeInstanceOf(SolverBusyError)
    await long
  }, 60_000)

  it('stops a search that exceeds its deadline and keeps serving afterwards', async () => {
    vi.stubEnv('VALHALLA_URL', '')
    configureSolverPool({ size: 1 })
    await runVRPOffThread(missions.slice(0, 5), drivers, exutoires, inst.date, {
      ...OPTS,
      timeBudgetMs: 300,
    })
    await expect(
      solveOffThread(
        {
          op: 'vrp',
          missions,
          drivers,
          exutoires,
          date: inst.date,
          options: { ...OPTS, timeBudgetMs: 5_000 },
        },
        { timeoutMs: 400 },
      ),
    ).rejects.toThrow(/temps maximum/)
    // The stuck thread was terminated; a new one takes the next search.
    const next = await runVRPOffThread(missions.slice(0, 5), drivers, exutoires, inst.date, {
      ...OPTS,
      timeBudgetMs: 300,
    })
    expect(next.stats.totalMissions).toBe(5)
  }, 60_000)

  it('falls back to the calling thread when no solver thread can be started', async () => {
    vi.stubEnv('VALHALLA_URL', '')
    vi.stubEnv('VRP_SOLVER_PATH', 'does/not/exist.mjs')
    configureSolverPool({ size: 1 })
    const result = await runVRPOffThread(missions.slice(0, 8), drivers, exutoires, inst.date, {
      ...OPTS,
      timeBudgetMs: 300,
    })
    expect(result.stats.totalMissions).toBe(8)
    expect(solverPoolStatus().inline).toBe(true)
  }, 60_000)

  it('re-sequences one route off the calling thread', async () => {
    configureSolverPool({ size: 1 })
    const driver = drivers[0]
    const solved = await solveOffThread({
      op: 'route',
      missions: missions.slice(0, 6),
      driver,
      ctx: {
        depotLat: driver.depotLat,
        depotLng: driver.depotLng,
        startTimeMin: 420,
        speedKmh: 50,
        exutoires,
        date: inst.date,
      },
      params: {
        timeBudgetMs: 300,
        seed: 3,
        iterations: 100,
        destroyRatio: 0.3,
        saT0Ratio: 0.06,
        saTMinRatio: 0.0003,
        rhoForget: 0.8,
      },
    })
    expect(solved.routes).toHaveLength(1)
    expect(solved.routes[0].driverId).toBe(driver.id)
    expect(Number.isFinite(solved.cost)).toBe(true)
  }, 60_000)
})
