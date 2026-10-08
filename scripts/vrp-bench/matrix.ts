/**
 * Measures the construction of the road matrix against a running Valhalla, with the matrix
 * builder of the tree it runs in (or another implementation given with BENCH_IMPL, to compare a
 * previous version on the same points).
 *
 *   VALHALLA_URL=http://localhost:8002 REDIS_URL=redis://localhost:6379 \
 *     npx tsx scripts/vrp-bench/matrix.ts pool.json out.jsonl single 5,10,20,50
 *     npx tsx scripts/vrp-bench/matrix.ts pool.json out.jsonl multi 50,100
 *
 * pool.json: [{ lat, lng }] — addresses a truck can reach (the benchmark must not measure the
 * time Valhalla takes to give up on random points in a field).
 *
 * `single`: one organisation of N drivers (8 missions per driver, 15 % of them on a site already
 * visited, one depot per 25 drivers, a few outlets). Four builds on the same organisation:
 *   cold   — nothing known;
 *   same   — the same points again (in-process cache dropped: only Redis is warm);
 *   plus5  — 5 % more missions (a re-optimisation after new orders);
 *   nextday— 70 % of the sites again, 30 % new.
 * `multi`: N drivers spread over organisations of 10, three optimisations at a time.
 *
 * Only Valhalla matrix cache keys are deleted from Redis before a cold run.
 */
import { readFileSync, appendFileSync } from 'node:fs'
import { execFile } from 'node:child_process'

interface Pt {
  lat: number
  lng: number
}
interface GeoPoint {
  id: string
  lat: number
  lng: number
}
type Build = (
  _points: GeoPoint[],
  _dims?: unknown,
  _options?: unknown,
) => Promise<{ source: string; degraded?: boolean; coverage?: number; size: number }>

const [poolPath, outPath, mode = 'single', sizesArg = '5,10,20'] = process.argv.slice(2)
if (!poolPath || !outPath) {
  console.error('usage: matrix.ts pool.json out.jsonl single|multi sizes')
  process.exit(2)
}

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pool: Pt[] = JSON.parse(readFileSync(poolPath, 'utf8'))
const CONTAINER = process.env.BENCH_VALHALLA_CONTAINER ?? 'projet_clem-valhalla-1'

/** Samples the Valhalla container while a build runs. */
function watchContainer(): { stop: () => { cpuMax: number; cpuAvg: number; memMaxMb: number } } {
  const cpu: number[] = []
  let memMax = 0
  let running = true
  const tick = () => {
    if (!running) return
    execFile(
      'docker',
      ['stats', '--no-stream', '--format', '{{.CPUPerc}} {{.MemUsage}}', CONTAINER],
      (err, stdout) => {
        if (!err) {
          const m = stdout.trim().match(/^([\d.]+)%\s+([\d.]+)(MiB|GiB)/)
          if (m) {
            cpu.push(parseFloat(m[1]))
            memMax = Math.max(memMax, parseFloat(m[2]) * (m[3] === 'GiB' ? 1024 : 1))
          }
        }
        if (running) setTimeout(tick, 250)
      },
    )
  }
  tick()
  return {
    stop: () => {
      running = false
      return {
        cpuMax: cpu.length ? Math.max(...cpu) : 0,
        cpuAvg: cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : 0,
        memMaxMb: Math.round(memMax),
      }
    },
  }
}

/**
 * Waits until Valhalla is idle. A request the client gave up on keeps a Valhalla thread busy
 * until it is done: without this pause a measurement would pay for the previous one.
 */
function drain(maxMs = 90_000): Promise<void> {
  return new Promise(resolve => {
    const t0 = Date.now()
    let calm = 0
    const tick = () => {
      execFile(
        'docker',
        ['stats', '--no-stream', '--format', '{{.CPUPerc}}', CONTAINER],
        (err, stdout) => {
          const cpu = err ? 0 : parseFloat(stdout)
          calm = cpu < 15 ? calm + 1 : 0
          if (calm >= 2 || Date.now() - t0 > maxMs) resolve()
          else setTimeout(tick, 300)
        },
      )
    }
    tick()
  })
}

/** Counts what actually goes to Valhalla, whatever the implementation. */
const wire = { requests: 0, cells: 0, failures: 0 }
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (!url.includes('/sources_to_targets')) return realFetch(input, init)
  wire.requests++
  try {
    const res = await realFetch(input, init)
    if (res.ok) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        sources?: unknown[]
        targets?: unknown[]
      }
      wire.cells += (body.sources?.length ?? 0) * (body.targets?.length ?? 0)
    } else wire.failures++
    return res
  } catch (err) {
    wire.failures++
    throw err
  }
}) as typeof fetch

async function withRedis<T>(
  fn: (_r: import('ioredis').Redis) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!process.env.REDIS_URL) return fallback
  const { default: Redis } = await import('ioredis')
  const r = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  try {
    await r.connect()
    return await fn(r)
  } finally {
    r.disconnect()
  }
}

async function matrixKeys(r: import('ioredis').Redis): Promise<string[]> {
  const out: string[] = []
  for (const pattern of ['valhalla:snap:*', 'valhalla:matrix:*']) {
    let cursor = '0'
    do {
      const [next, keys] = await r.scan(cursor, 'MATCH', pattern, 'COUNT', 500)
      cursor = next
      out.push(...keys)
    } while (cursor !== '0')
  }
  return out
}

const clearMatrixCache = () =>
  withRedis(async r => {
    const keys = await matrixKeys(r)
    if (keys.length) await r.del(...keys)
  }, undefined)

const redisMatrixBytes = () =>
  withRedis(async r => {
    let total = 0
    for (const k of await matrixKeys(r)) total += Number(await r.call('MEMORY', 'USAGE', k)) || 0
    return total
  }, 0)

interface Org {
  scope: string
  points: GeoPoint[]
  hubIds: string[]
  sites: Pt[]
}

/** Points of one organisation: missions (some sharing a site), depots, outlets. */
function makeOrg(scope: string, drivers: number, sites: Pt[], r: () => number): Org {
  const missions = drivers * 8
  const points: GeoPoint[] = []
  const used: Pt[] = []
  let s = 0
  for (let i = 0; i < missions; i++) {
    const again = used.length > 0 && r() < 0.15
    const p = again ? used[Math.floor(r() * used.length)] : sites[s++ % sites.length]
    if (!again) used.push(p)
    points.push({ id: `m${i}`, lat: p.lat, lng: p.lng })
  }
  const hubIds: string[] = []
  const depots = Math.max(1, Math.ceil(drivers / 25))
  for (let d = 0; d < depots; d++) {
    const p = sites[s++ % sites.length]
    points.push({ id: `depot:d${d}`, lat: p.lat, lng: p.lng })
    hubIds.push(`depot:d${d}`)
  }
  const outlets = Math.min(8, 2 + Math.floor(drivers / 50))
  for (let e = 0; e < outlets; e++) {
    const p = sites[s++ % sites.length]
    points.push({ id: `exu:e${e}`, lat: p.lat, lng: p.lng })
    hubIds.push(`exu:e${e}`)
  }
  return { scope, points, hubIds, sites: used }
}

function shuffled<T>(xs: T[], r: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const DIMS = { weightTon: 26, heightM: 4, widthM: 2.55, lengthM: 12, axleCount: 3, hazmat: false }

interface Impl {
  build: Build
  reset: () => void
  last: () => Record<string, unknown> | null
  background: () => boolean
}

async function loadImpl(): Promise<Impl> {
  const mod = (await import(process.env.BENCH_IMPL ?? '../../src/lib/vrp/valhallaMatrix')) as {
    buildValhallaMatrix: Build
    _resetValhallaBreaker: () => void
    _lastValhallaBuild?: () => Record<string, unknown> | null
    _valhallaBackgroundActive?: () => boolean
  }
  return {
    build: mod.buildValhallaMatrix,
    reset: mod._resetValhallaBreaker,
    last: mod._lastValhallaBuild ?? (() => null),
    background: mod._valhallaBackgroundActive ?? (() => false),
  }
}

const IMPL_NAME = process.env.BENCH_IMPL ? 'before' : 'after'

async function measure(label: string, extra: Record<string, unknown>, org: Org, impl: Impl) {
  await drain()
  impl.reset() // closes the breaker and drops the in-process cache: only Redis stays warm
  wire.requests = 0
  wire.cells = 0
  wire.failures = 0
  const watch = watchContainer()
  const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  const m = await impl.build(org.points, DIMS, { scope: org.scope, hubIds: org.hubIds })
  const ms = Math.round(performance.now() - t0)
  const cpu = process.cpuUsage(cpu0)
  const container = watch.stop()
  const n = org.points.length
  const unique = new Set(org.points.map(p => `${p.lat},${p.lng}`)).size
  const last = impl.last()
  const row = {
    impl: IMPL_NAME,
    label,
    ...extra,
    points: n,
    uniquePoints: unique,
    ms,
    source: m.source,
    degraded: Boolean(m.degraded),
    coverage:
      typeof m.coverage === 'number'
        ? Math.round(m.coverage * 1000) / 1000
        : m.source === 'haversine'
          ? 0
          : Math.min(1, Math.round((wire.cells / (n * n)) * 1000) / 1000),
    requests: wire.requests,
    requestFailures: wire.failures,
    cellsAsked: wire.cells,
    reusedCells: (last?.reusedCells as number | undefined) ?? null,
    nodeCpuMs: Math.round((cpu.user + cpu.system) / 1000),
    nodeRssMb: Math.round(process.memoryUsage().rss / 1048576),
    valhallaCpuMaxPct: container.cpuMax,
    valhallaCpuAvgPct: container.cpuAvg,
    valhallaMemMaxMb: container.memMaxMb,
  }
  appendFileSync(outPath, JSON.stringify(row) + '\n')
  process.stderr.write(
    `${row.impl} ${label} ${JSON.stringify(extra)} pts=${n} uniq=${unique} ${ms} ms src=${m.source} cov=${row.coverage} degraded=${row.degraded} req=${wire.requests} fail=${wire.failures} cells=${wire.cells} reused=${row.reusedCells} vmem=${container.memMaxMb}MB vcpu=${container.cpuAvg}%\n`,
  )
  return row
}

/** Lets a background completion finish (new implementation only) before the next measurement. */
async function settle(impl: Impl, maxMs: number): Promise<void> {
  const wait = Number(process.env.BENCH_SETTLE_MS ?? maxMs)
  if (wait <= 0 || !impl.last()) return
  const t0 = Date.now()
  while (Date.now() - t0 < wait && impl.background()) await new Promise(r => setTimeout(r, 500))
}

async function single(driversList: number[]) {
  const impl = await loadImpl()
  for (const drivers of driversList) {
    const r = rng(1000 + drivers)
    const sites = shuffled(pool, r)
    const need = drivers * 8 + 20
    if (sites.length < need * 1.4)
      process.stderr.write(
        `pool has ${sites.length} points for ${need} needed — sites repeat more than planned\n`,
      )
    await clearMatrixCache()
    const scope = `bench-single-${drivers}`
    const day1 = makeOrg(scope, drivers, sites, rng(7))
    const cold = await measure('cold', { drivers }, day1, impl)
    if (cold.degraded) {
      const t0 = Date.now()
      await settle(impl, 600_000)
      process.stderr.write(`background settled after ${Date.now() - t0} ms\n`)
      appendFileSync(
        outPath,
        JSON.stringify({
          impl: IMPL_NAME,
          label: 'background',
          drivers,
          ms: Date.now() - t0,
          requests: wire.requests,
          cellsAsked: wire.cells,
        }) + '\n',
      )
    }
    await measure('same', { drivers }, day1, impl)

    // 5 % more missions on sites never seen.
    const extraCount = Math.max(1, Math.round(drivers * 8 * 0.05))
    const fresh = sites.slice(need, need + extraCount)
    const plus: Org = {
      ...day1,
      points: [...day1.points, ...fresh.map((p, i) => ({ id: `x${i}`, lat: p.lat, lng: p.lng }))],
    }
    await measure('plus5', { drivers }, plus, impl)
    await settle(impl, 600_000)

    // Next day: 70 % of yesterday's sites, 30 % new ones, same depots and outlets.
    const keep = shuffled(day1.sites, rng(99)).slice(0, Math.round(day1.sites.length * 0.7))
    const news = sites.slice(
      need + extraCount,
      need + extraCount + (day1.sites.length - keep.length),
    )
    const hubs = day1.points.filter(p => day1.hubIds.includes(p.id))
    const day2: Org = {
      scope,
      hubIds: day1.hubIds,
      sites: [],
      points: [
        ...[...keep, ...news].map((p, i) => ({ id: `n${i}`, lat: p.lat, lng: p.lng })),
        ...hubs,
      ],
    }
    await measure('nextday', { drivers }, day2, impl)
    await settle(impl, 600_000)
    process.stderr.write(`redis matrix bytes: ${await redisMatrixBytes()}\n`)
  }
}

async function multi(driversList: number[]) {
  const impl = await loadImpl()
  for (const drivers of driversList) {
    const orgs = Math.max(1, Math.round(drivers / 10))
    const sites = shuffled(pool, rng(2000 + drivers))
    await clearMatrixCache()
    const all: Org[] = []
    for (let o = 0; o < orgs; o++) {
      // Each organisation works around its own base: its sites are the pool points nearest to one seed.
      const seed = sites[(o * 131) % sites.length]
      const dist = (p: Pt) => Math.hypot(p.lat - seed.lat, (p.lng - seed.lng) * 0.7)
      const near = [...sites].sort((a, b) => dist(a) - dist(b)).slice(0, 260)
      all.push(makeOrg(`bench-multi-${drivers}-${o}`, 10, shuffled(near, rng(o + 1)), rng(o + 11)))
    }
    for (const pass of ['cold', 'same'] as const) {
      await drain()
      impl.reset()
      wire.requests = 0
      wire.cells = 0
      wire.failures = 0
      const watch = watchContainer()
      const times: number[] = []
      let complete = 0,
        degraded = 0,
        failed = 0
      let next = 0
      const t0 = performance.now()
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (next < all.length) {
            const org = all[next++]
            const s = performance.now()
            const m = await impl.build(org.points, DIMS, { scope: org.scope, hubIds: org.hubIds })
            times.push(Math.round(performance.now() - s))
            if (m.source === 'haversine') failed++
            else if (m.degraded) degraded++
            else complete++
          }
        }),
      )
      const wall = Math.round(performance.now() - t0)
      const container = watch.stop()
      times.sort((a, b) => a - b)
      const row = {
        impl: IMPL_NAME,
        label: `multi-${pass}`,
        drivers,
        orgs,
        wallMs: wall,
        p50Ms: times[Math.floor(times.length / 2)],
        p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
        maxMs: times[times.length - 1],
        complete,
        degraded,
        failed,
        requests: wire.requests,
        requestFailures: wire.failures,
        cellsAsked: wire.cells,
        nodeRssMb: Math.round(process.memoryUsage().rss / 1048576),
        valhallaCpuMaxPct: container.cpuMax,
        valhallaCpuAvgPct: container.cpuAvg,
        valhallaMemMaxMb: container.memMaxMb,
        redisMatrixBytes: await redisMatrixBytes(),
      }
      appendFileSync(outPath, JSON.stringify(row) + '\n')
      process.stderr.write(JSON.stringify(row) + '\n')
    }
  }
}

const sizes = sizesArg
  .split(',')
  .map(Number)
  .filter(n => n > 0)
;(mode === 'multi' ? multi(sizes) : single(sizes))
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
