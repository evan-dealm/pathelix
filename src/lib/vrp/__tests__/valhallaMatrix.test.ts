import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GeoPoint } from '../valhallaMatrix'
import { haversineKm } from '../distanceCache'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/algorithm', () => ({
  trafficFactor: vi.fn(() => 1.0),
}))

// In-memory Redis so the cache round-trip itself is exercised (binary values included).
const redisStore = vi.hoisted(() => new Map<string, string | Buffer>())
const redisState = vi.hoisted(() => ({ available: false, failWrites: false }))
vi.mock('@/lib/redisClient', () => ({
  get REDIS_AVAILABLE() {
    return redisState.available
  },
  getRedisClient: vi.fn(async () =>
    redisState.available
      ? {
          get: async (k: string) => {
            const v = redisStore.get(k)
            return v === undefined ? null : v.toString()
          },
          getBuffer: async (k: string) => {
            const v = redisStore.get(k)
            return v === undefined ? null : Buffer.from(v)
          },
          set: async (k: string, v: string | Buffer) => {
            if (redisState.failWrites)
              throw new Error("OOM command not allowed when used memory > 'maxmemory'")
            redisStore.set(k, v)
            return 'OK'
          },
          del: async (...keys: string[]) => {
            for (const k of keys) redisStore.delete(k)
            return keys.length
          },
          expire: async () => 1,
        }
      : null,
  ),
}))

const points: GeoPoint[] = [
  { id: 'p0', lat: 45.76, lng: 6.05 },
  { id: 'p1', lat: 45.77, lng: 6.06 },
  { id: 'p2', lat: 45.78, lng: 6.07 },
]

type Loc = { lat: number; lon: number }
type WireBody = { sources: Loc[]; targets: Loc[]; verbose?: boolean; date_time?: unknown }

function grid(n: number, prefix = 'g', lat0 = 45.0, lng0 = 5.0): GeoPoint[] {
  const side = Math.ceil(Math.sqrt(n))
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    lat: lat0 + Math.floor(i / side) * 0.01,
    lng: lng0 + (i % side) * 0.013,
  }))
}

describe('buildValhallaMatrix — no Valhalla URL (haversine fallback)', () => {
  beforeEach(() => {
    vi.stubEnv('VALHALLA_URL', '')
    vi.stubEnv('VALHALLA_FALLBACK_URL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns haversine matrix when VALHALLA_URL not set', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.source).toBe('haversine')
    expect(matrix.size).toBe(3)
  })

  it('indexOf returns correct index for known point', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.indexOf('p0')).toBe(0)
    expect(matrix.indexOf('p2')).toBe(2)
    expect(matrix.indexOf('unknown')).toBe(-1)
  })

  it('distance returns 0 for same point', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.distance(0, 0)).toBe(0)
    expect(matrix.distance(1, 1)).toBe(0)
  })

  it('distance returns positive value between different points', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.distance(0, 1)).toBeGreaterThan(0)
    expect(matrix.distance(0, 2)).toBeGreaterThan(matrix.distance(0, 1))
  })

  it('duration returns 0 for same point', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.duration(0, 0)).toBe(0)
  })

  it('duration returns positive value between different points', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.duration(0, 1)).toBeGreaterThan(0)
  })

  it('returns haversine when fewer than 2 points', async () => {
    vi.stubEnv('VALHALLA_URL', 'http://valhalla:8002')
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix([points[0]])
    expect(matrix.source).toBe('haversine')
  })

  it('distance returns 0 for out-of-bounds indices', async () => {
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.distance(-1, 0)).toBe(0)
    expect(matrix.distance(0, 99)).toBe(0)
  })
})

describe('buildValhallaMatrix — Valhalla available (fetch mocked)', () => {
  beforeEach(async () => {
    vi.stubEnv('VALHALLA_URL', 'http://valhalla:8002')
    vi.stubEnv('VALHALLA_TIMEOUT_MS', '5000')
    ;(await import('../valhallaMatrix'))._resetValhallaBreaker()
    redisStore.clear()
    redisState.available = false
    redisState.failWrites = false
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  // Distances depend only on the pair of points: a deterministic fake Valhalla.
  function pairDistance(a: Loc, b: Loc) {
    return Math.round((a.lat * 1000 + b.lon * 7) * 10) / 10
  }
  const same = (a: Loc, b: Loc) => a.lat === b.lat && a.lon === b.lon

  /** Fake Valhalla. `seen` records every request; `cell` may return null (no route). */
  function fakeValhalla(
    opts: {
      cell?: (_src: Loc, _tgt: Loc) => { distance: number; time: number } | null
      compact?: boolean
      delayMs?: number
      reject?: (_body: WireBody) => { status: number; error_code?: number } | null
    } = {},
  ) {
    const seen: WireBody[] = []
    const state = { inFlight: 0, maxInFlight: 0 }
    const cell = opts.cell ?? ((s, t) => ({ distance: pairDistance(s, t), time: 60 }))
    const spy = vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as WireBody
      seen.push(body)
      state.inFlight++
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      try {
        if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs))
        const refused = opts.reject?.(body)
        if (refused) {
          return {
            ok: false,
            status: refused.status,
            text: async () => JSON.stringify({ error_code: refused.error_code }),
          } as Response
        }
        const rows = body.sources.map(src =>
          body.targets.map(tgt => (same(src, tgt) ? { distance: 0, time: 0 } : cell(src, tgt))),
        )
        const payload = opts.compact
          ? {
              sources_to_targets: {
                distances: rows.map(r => r.map(c => c?.distance ?? null)),
                durations: rows.map(r => r.map(c => c?.time ?? null)),
              },
            }
          : { sources_to_targets: rows }
        return { ok: true, status: 200, json: async () => payload } as Response
      } finally {
        state.inFlight--
      }
    })
    const cells = () => seen.reduce((n, b) => n + b.sources.length * b.targets.length, 0)
    return { spy, seen, state, cells }
  }

  const loc = (p: GeoPoint): Loc => ({ lat: p.lat, lon: p.lng })

  it('uses Valhalla when URL set and fetch succeeds', async () => {
    fakeValhalla({ cell: () => ({ distance: 1.5, time: 120 }) })
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.source).toBe('valhalla')
    expect(matrix.size).toBe(points.length)
    expect(matrix.distance(0, 1)).toBe(1.5)
    expect(matrix.duration(0, 1)).toBe(2) // 120s / 60 = 2min
    expect(matrix.coverage).toBe(1)
    expect(matrix.degraded).toBe(false)
  })

  it('asks for the compact answer and reads it (two number tables instead of one object per cell)', async () => {
    const v = fakeValhalla({ compact: true })
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(v.seen[0].verbose).toBe(false)
    expect(matrix.distance(0, 2)).toBeCloseTo(pairDistance(loc(points[0]), loc(points[2])), 1)
    expect(matrix.duration(0, 2)).toBe(1)
  })

  it('falls back to haversine when Valhalla fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.source).toBe('haversine')
  })

  it('falls back to haversine when Valhalla returns non-200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    } as Response)
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(points)
    expect(matrix.source).toBe('haversine')
  })

  // Regression: found via manual QA on a 100-driver/40-mission tenant — every real VRP run
  // silently used pure haversine distances, no matter how healthy Valhalla was. Root cause:
  // the chunk size sent sources.length * targets.length = 6400 pairs per request, and
  // Valhalla's costmatrix action rejects anything over its max_matrix_location_pairs (2500 by
  // default) with a 400 — so every single chunk failed, on every run with >80 combined
  // points. This asserts the actual wire request never exceeds that budget, for a fleet size
  // (120 points) well past where the old 80-point chunk size broke.
  it('never sends a sources*targets product above Valhallas default max_matrix_location_pairs (2500)', async () => {
    const v = fakeValhalla()
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const matrix = await buildValhallaMatrix(grid(120))

    expect(matrix.source).toBe('valhalla-chunked')
    expect(v.seen.length).toBeGreaterThan(1)
    for (const body of v.seen) {
      expect(body.sources.length * body.targets.length).toBeLessThanOrEqual(2500)
    }
    expect(matrix.coverage).toBe(1)
  })

  it('serves a cached matrix correctly when the same points come back in another order', async () => {
    redisState.available = true
    const v = fakeValhalla()
    const mod = await import('../valhallaMatrix')
    await mod.buildValhallaMatrix(points) // fills the cache
    mod._resetValhallaBreaker() // another process: only Redis knows the matrix
    v.spy.mockClear()

    const reordered = [points[2], points[0], points[1]]
    const m = await mod.buildValhallaMatrix(reordered)
    expect(v.spy).not.toHaveBeenCalled() // cache hit
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i === j) continue
        expect(m.distance(i, j)).toBeCloseTo(pairDistance(loc(reordered[i]), loc(reordered[j])), 1)
      }
    }
  })

  // The old rule was "never cache a degraded matrix". The cache now only ever holds real cells:
  // a matrix cut short is saved for what Valhalla did answer, the next run asks for the rest, and
  // no straight-line value can come back from the cache as if it were a road distance.
  it('keeps the real cells of a matrix cut short by a failure, and never an estimated one', async () => {
    redisState.available = true
    const many = grid(120, 'q')
    let calls = 0
    const failing = fakeValhalla({ reject: () => (++calls > 3 ? { status: 503 } : null) })
    const mod = await import('../valhallaMatrix')
    const first = await mod.buildValhallaMatrix(many)
    expect(first.degraded).toBe(true)
    expect(first.coverage).toBeGreaterThan(0)
    expect(first.coverage).toBeLessThan(1)
    failing.spy.mockRestore()

    mod._resetValhallaBreaker()
    const ok = fakeValhalla()
    const second = await mod.buildValhallaMatrix(many)
    expect(second.degraded).toBe(false)
    expect(second.coverage).toBe(1)
    // Three requests of 40 x 40 were answered before the failure: only the rest is asked again.
    expect(failing.seen.length).toBeGreaterThan(3)
    expect(ok.cells()).toBeLessThanOrEqual(120 * 120 - 3 * 1600)
    for (const [i, j] of [
      [0, 119],
      [57, 3],
      [119, 60],
    ]) {
      expect(second.distance(i, j)).toBeCloseTo(pairDistance(loc(many[i]), loc(many[j])), 1)
    }
  })

  it('skips Valhalla for a while after a failure (no 15 s wait per run while it is down)', async () => {
    const spy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'))
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    expect((await buildValhallaMatrix(points)).source).toBe('haversine')
    spy.mockClear()
    expect((await buildValhallaMatrix(points)).source).toBe('haversine')
    expect(spy).not.toHaveBeenCalled()
  })

  it('cache keys include every vehicle dimension (axles, hazmat) but not the point order', async () => {
    const { matrixCacheKey } = await import('../valhallaMatrix')
    const dims = {
      weightTon: 26,
      heightM: 4,
      widthM: 2.55,
      lengthM: 12,
      axleCount: 3,
      hazmat: false,
    }
    expect(matrixCacheKey(points, dims)).toBe(matrixCacheKey([...points].reverse(), dims))
    expect(matrixCacheKey(points, dims)).not.toBe(matrixCacheKey(points, { ...dims, axleCount: 4 }))
    expect(matrixCacheKey(points, dims)).not.toBe(matrixCacheKey(points, { ...dims, hazmat: true }))
  })

  it('sends each site once when several missions share its coordinates', async () => {
    const v = fakeValhalla()
    const site = { lat: 45.5, lng: 5.5 }
    const pts: GeoPoint[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `same${i}`, ...site })),
      { id: 'a', lat: 45.6, lng: 5.6 },
      { id: 'b', lat: 45.7, lng: 5.7 },
    ]
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const m = await buildValhallaMatrix(pts)
    expect(v.seen).toHaveLength(1)
    expect(v.seen[0].sources).toHaveLength(3)
    expect(m.size).toBe(7)
    expect(m.distance(0, 3)).toBe(0) // two missions on the same site
    expect(m.distance(2, 5)).toBeCloseTo(
      pairDistance({ lat: 45.5, lon: 5.5 }, { lat: 45.6, lon: 5.6 }),
      1,
    )
    expect(m.distance(6, 4)).toBeCloseTo(
      pairDistance({ lat: 45.7, lon: 5.7 }, { lat: 45.5, lon: 5.5 }),
      1,
    )
  })

  it('only asks for the row and the column of a mission added since the last run', async () => {
    redisState.available = true
    const base = grid(100)
    const v = fakeValhalla()
    const mod = await import('../valhallaMatrix')
    await mod.buildValhallaMatrix(base, undefined, { scope: 'tenant-a' })
    expect(v.cells()).toBeGreaterThanOrEqual(100 * 99)
    v.seen.length = 0
    mod._resetValhallaBreaker()

    const added: GeoPoint = { id: 'new', lat: 45.033, lng: 5.071 }
    const m = await mod.buildValhallaMatrix([...base, added], undefined, { scope: 'tenant-a' })
    expect(v.cells()).toBeLessThanOrEqual(2 * 100 + 10) // 200 cells, not 10 201
    expect(m.coverage).toBe(1)
    expect(m.distance(100, 7)).toBeCloseTo(pairDistance(loc(added), loc(base[7])), 1)
    expect(m.distance(42, 100)).toBeCloseTo(pairDistance(loc(base[42]), loc(added)), 1)
    expect(m.distance(3, 77)).toBeCloseTo(pairDistance(loc(base[3]), loc(base[77])), 1)
  })

  it("reuses yesterday's matrix for the sites that come back the next day", async () => {
    redisState.available = true
    const day1 = grid(90, 'd')
    const v = fakeValhalla()
    const mod = await import('../valhallaMatrix')
    await mod.buildValhallaMatrix(day1, undefined, { scope: 't' })
    v.seen.length = 0
    mod._resetValhallaBreaker()
    const day2 = [...day1.slice(0, 60), ...grid(30, 'n', 46.0, 5.0)]
    const m = await mod.buildValhallaMatrix(day2, undefined, { scope: 't' })
    expect(m.coverage).toBe(1)
    // 60 x 60 known pairs are not asked again.
    expect(v.cells()).toBeLessThan(90 * 90 - 60 * 60 + 600)
    expect(m.distance(10, 50)).toBeCloseTo(pairDistance(loc(day2[10]), loc(day2[50])), 1)
    expect(m.distance(10, 75)).toBeCloseTo(pairDistance(loc(day2[10]), loc(day2[75])), 1)
  })

  it("never serves one organisation's matrix to another", async () => {
    redisState.available = true
    const v = fakeValhalla()
    const mod = await import('../valhallaMatrix')
    await mod.buildValhallaMatrix(points, undefined, { scope: 'tenant-a' })
    v.spy.mockClear()
    await mod.buildValhallaMatrix(points, undefined, { scope: 'tenant-b' })
    expect(v.spy).toHaveBeenCalled()
    v.spy.mockClear()
    await mod.buildValhallaMatrix(points, undefined, { scope: 'tenant-a' })
    expect(v.spy).not.toHaveBeenCalled()
  })

  it('builds the same matrix once when two optimisations ask for it at the same time', async () => {
    const v = fakeValhalla({ delayMs: 5 })
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const pts = grid(60)
    const [a, b] = await Promise.all([
      buildValhallaMatrix(pts, undefined, { scope: 's' }),
      buildValhallaMatrix([...pts].reverse(), undefined, { scope: 's' }),
    ])
    expect(v.cells()).toBeLessThanOrEqual(60 * 60)
    expect(a.distance(0, 59)).toBeCloseTo(b.distance(59, 0), 3)
  })

  it('shares VALHALLA_MAX_CONCURRENT between matrices built at the same time', async () => {
    vi.stubEnv('VALHALLA_MAX_CONCURRENT', '3')
    const v = fakeValhalla({ delayMs: 3 })
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    await Promise.all([
      buildValhallaMatrix(grid(130, 'a'), undefined, { scope: 'a' }),
      buildValhallaMatrix(grid(130, 'b', 46), undefined, { scope: 'b' }),
      buildValhallaMatrix(grid(130, 'c', 47), undefined, { scope: 'c' }),
    ])
    expect(v.state.maxInFlight).toBeLessThanOrEqual(3)
    expect(v.state.maxInFlight).toBeGreaterThan(1)
  })

  describe('partial matrices', () => {
    // Fake road network: road distance = 2 x straight line, 30 km/h.
    const roadCell = (s: Loc, t: Loc) => {
      const km = haversineKm(s.lat, s.lon, t.lat, t.lon) * 2
      return { distance: km, time: (km / 30) * 3600 }
    }

    it('returns what it has when the budget runs out, without opening the circuit breaker', async () => {
      const v = fakeValhalla({ delayMs: 40, cell: roadCell })
      const mod = await import('../valhallaMatrix')
      const pts = grid(400)
      const m = await mod.buildValhallaMatrix(pts, undefined, { budgetMs: 150 })
      expect(m.source).not.toBe('haversine')
      expect(m.degraded).toBe(true)
      expect(m.coverage).toBeGreaterThan(0)
      expect(m.coverage).toBeLessThan(1)

      // The breaker stayed closed: the very next build goes to Valhalla again.
      v.spy.mockClear()
      await mod.buildValhallaMatrix(points)
      expect(v.spy).toHaveBeenCalled()
    })

    // Found on a real Valhalla: once requests took more than 250 ms, the running average made the
    // per-request timeout a fractional number, AbortSignal.timeout() threw, and the build read it
    // as "Valhalla is down" — breaker open after a third of the budget, 13 % of the cells.
    it('keeps using its budget when requests are slow (timeouts stay valid numbers)', async () => {
      const v = fakeValhalla({ delayMs: 310, cell: roadCell })
      const timeouts: unknown[] = []
      const realTimeout = AbortSignal.timeout.bind(AbortSignal)
      vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
        timeouts.push(ms)
        return realTimeout(ms)
      })
      const mod = await import('../valhallaMatrix')
      const m = await mod.buildValhallaMatrix(grid(400), undefined, { budgetMs: 2_500 })
      expect(m.source).not.toBe('haversine')
      expect(timeouts.length).toBeGreaterThan(8)
      expect(timeouts.every(ms => Number.isInteger(ms))).toBe(true)
      // The whole budget was used (several rounds of requests), and the breaker is still closed.
      expect(v.seen.length).toBeGreaterThan(8)
      v.spy.mockClear()
      await mod.buildValhallaMatrix(points)
      expect(v.spy).toHaveBeenCalled()
    })

    it('estimates the missing cells on the scale of the real ones (detour ratio and speed)', async () => {
      fakeValhalla({ delayMs: 40, cell: roadCell })
      const mod = await import('../valhallaMatrix')
      const pts = grid(400)
      const m = await mod.buildValhallaMatrix(pts, undefined, { budgetMs: 150 })
      expect(m.degraded).toBe(true)
      let checked = 0
      for (let i = 0; i < pts.length; i += 7) {
        for (let j = 3; j < pts.length; j += 11) {
          if (i === j) continue
          const hav = haversineKm(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng)
          // Real or estimated, every cell is on the 2x / 30 km/h scale of this network — the default
          // straight-line factors (1.2–1.5 at 50 km/h) would be far off.
          expect(m.distance(i, j) / hav).toBeGreaterThan(1.9)
          expect(m.distance(i, j) / hav).toBeLessThan(2.1)
          expect(m.distance(i, j) / (m.duration(i, j) / 60)).toBeGreaterThan(28)
          expect(m.distance(i, j) / (m.duration(i, j) / 60)).toBeLessThan(32)
          checked++
        }
      }
      expect(checked).toBeGreaterThan(1000)
    })

    it('fetches each block against itself, then depots and outlets, then pairs of blocks', async () => {
      const v = fakeValhalla({ delayMs: 15, cell: roadCell })
      const mod = await import('../valhallaMatrix')
      const pts = [
        ...grid(400),
        { id: 'depot:d1', lat: 45.1, lng: 5.13 },
        { id: 'exu:e1', lat: 45.05, lng: 5.2 },
      ]
      const m = await mod.buildValhallaMatrix(pts, undefined, {
        budgetMs: 400,
        hubIds: ['depot:d1', 'exu:e1'],
      })
      expect(m.degraded).toBe(true)
      const isHub = (l: Loc) =>
        (l.lat === 45.1 && l.lon === 5.13) || (l.lat === 45.05 && l.lon === 5.2)
      const key = (ls: Loc[]) =>
        ls
          .map(l => `${l.lat},${l.lon}`)
          .sort()
          .join('|')
      const kind = (b: WireBody) =>
        b.sources.some(isHub) || b.targets.some(isHub)
          ? 'hub'
          : key(b.sources) === key(b.targets)
            ? 'own'
            : 'pair'
      const kinds = v.seen.map(kind)
      const own = kinds.filter(k => k === 'own').length
      const hub = kinds.filter(k => k === 'hub').length
      expect(own).toBeGreaterThanOrEqual(9) // 400 points = 9 blocks
      expect(hub).toBeGreaterThan(0)
      // Order: blocks against themselves, then hubs, then pairs (±4: requests in flight together).
      expect(kinds.lastIndexOf('own')).toBeLessThan(own + 4)
      const firstPair = kinds.indexOf('pair')
      expect(firstPair === -1 || firstPair >= own + hub - 4).toBe(true)
      // A block is compact: its points are close together.
      for (const body of v.seen.filter(b => kind(b) === 'own')) {
        const spanLat =
          Math.max(...body.sources.map(l => l.lat)) - Math.min(...body.sources.map(l => l.lat))
        expect(spanLat).toBeLessThan(0.12) // the whole grid spans 0.2° of latitude
      }
    })

    it('finishes in the background a matrix that ran out of budget, on a copy', async () => {
      vi.stubEnv('VALHALLA_BACKGROUND_MS', '5000')
      const v = fakeValhalla({ delayMs: 10, cell: roadCell })
      const mod = await import('../valhallaMatrix')
      const pts = grid(300)
      const first = await mod.buildValhallaMatrix(pts, undefined, { scope: 'bg', budgetMs: 60 })
      expect(first.degraded).toBe(true)
      const frozen = first.distance(0, 299)

      // Wait for the background run to go quiet.
      let last = -1
      for (let i = 0; i < 200 && last !== v.seen.length; i++) {
        last = v.seen.length
        await new Promise(r => setTimeout(r, 60))
      }
      // The matrix already handed to the search did not change under it.
      expect(first.distance(0, 299)).toBe(frozen)
      expect(first.degraded).toBe(true)

      v.spy.mockClear()
      const second = await mod.buildValhallaMatrix(pts, undefined, { scope: 'bg', budgetMs: 60 })
      expect(second.degraded).toBe(false)
      expect(second.coverage).toBe(1)
      expect(v.spy).not.toHaveBeenCalled()
    })
  })

  describe('addresses Valhalla cannot route', () => {
    it('sets aside a point no depot can reach instead of searching for it in every block', async () => {
      const lost = { lat: 45.07, lon: 5.091 }
      const isLost = (l: Loc) => l.lat === lost.lat && l.lon === lost.lon
      const v = fakeValhalla({
        cell: (s, t) =>
          isLost(s) || isLost(t) ? null : { distance: pairDistance(s, t), time: 60 },
      })
      const mod = await import('../valhallaMatrix')
      const pts = [
        ...grid(150),
        { id: 'lost', lat: lost.lat, lng: lost.lon },
        { id: 'depot:d', lat: 45.02, lng: 5.02 },
      ]
      const m = await mod.buildValhallaMatrix(pts, undefined, { hubIds: ['depot:d'] })

      const withLost = v.seen.filter(b => b.sources.some(isLost) || b.targets.some(isLost))
      const isDepot = (l: Loc) => l.lat === 45.02 && l.lon === 5.02
      // It appears with its own block (asked first) and against the depot — never again in the
      // requests between blocks, which are most of the work (12 of them here).
      const elsewhere = withLost.filter(b => !b.sources.some(isDepot) && !b.targets.some(isDepot))
      expect(elsewhere.length).toBeLessThanOrEqual(1)
      expect(withLost.length).toBeLessThanOrEqual(3)
      expect(mod._lastValhallaBuild()?.unreachablePoints).toBe(1)
      // The plan still gets a usable (estimated) distance for it, and the matrix is not "degraded".
      const li = m.indexOf('lost')
      expect(m.distance(li, 0)).toBeGreaterThan(0)
      expect(m.duration(0, li)).toBeGreaterThan(0)
      expect(m.degraded).toBe(false)
      expect(m.coverage).toBeLessThan(1)
      expect(m.coverage).toBeGreaterThan(0.95)
    })

    it('isolates an address Valhalla rejects outright; the rest of the matrix stays real', async () => {
      const bad = { lat: 45.03, lon: 5.039 }
      const isBad = (l: Loc) => l.lat === bad.lat && l.lon === bad.lon
      const v = fakeValhalla({
        // Valhalla answers 400 (171: no suitable edges near location) for the whole request.
        reject: body =>
          body.sources.some(isBad) || body.targets.some(isBad)
            ? { status: 400, error_code: 171 }
            : null,
      })
      const mod = await import('../valhallaMatrix')
      const pts = [...grid(30), { id: 'bad', lat: bad.lat, lng: bad.lon }]
      const m = await mod.buildValhallaMatrix(pts)
      expect(m.source).not.toBe('haversine')
      expect(m.degraded).toBe(false)
      expect(m.distance(0, 29)).toBeCloseTo(pairDistance(loc(pts[0]), loc(pts[29])), 1)
      expect(m.distance(m.indexOf('bad'), 5)).toBeGreaterThan(0)

      // One bad address is not an outage: the breaker stays closed.
      v.spy.mockClear()
      await mod.buildValhallaMatrix(points)
      expect(v.spy).toHaveBeenCalled()
    })

    // Observed on Valhalla 3.5: a single mission geocoded outside the tiles (or more than
    // max_matrix_distance away) makes every request that contains it fail with 400/154. It used to
    // fail every chunk, drop the whole matrix to straight lines and open the breaker for everyone.
    it('sets aside an address too far for Valhalla after a few refusals, without halving every block for it', async () => {
      const far = { lat: 48.8566, lon: 2.3522 }
      const isFar = (l: Loc) => l.lat === far.lat && l.lon === far.lon
      const v = fakeValhalla({
        reject: body =>
          body.sources.some(isFar) || body.targets.some(isFar)
            ? { status: 400, error_code: 154 }
            : null,
      })
      const mod = await import('../valhallaMatrix')
      const pts = [...grid(200), { id: 'paris', lat: far.lat, lng: far.lon }]
      const m = await mod.buildValhallaMatrix(pts)
      expect(m.degraded).toBe(false)
      expect(m.coverage).toBeGreaterThan(0.98)
      expect(mod._lastValhallaBuild()?.unreachablePoints).toBe(1)
      expect(m.distance(0, 199)).toBeCloseTo(pairDistance(loc(pts[0]), loc(pts[199])), 1)
      // Narrowing it down happens in the few block pairs in flight at that moment (4 at most, ~12
      // requests each), not in each of the 11 block pairs that contain the address.
      expect(
        v.seen.filter(b => b.sources.some(isFar) || b.targets.some(isFar)).length,
      ).toBeLessThan(70)
    })

    it('reads "no path for any pair" (400/442) as an answer, in one request', async () => {
      const island = { lat: 45.2, lon: 5.73 }
      const isIsland = (l: Loc) => l.lat === island.lat && l.lon === island.lon
      const v = fakeValhalla({
        cell: (s, t) =>
          isIsland(s) || isIsland(t) ? null : { distance: pairDistance(s, t), time: 60 },
        // Valhalla answers 400/442 instead of a table of nulls when no pair at all has a path.
        reject: body =>
          body.sources.every(isIsland) || body.targets.every(isIsland)
            ? { status: 400, error_code: 442 }
            : null,
      })
      const mod = await import('../valhallaMatrix')
      const pts = [
        ...grid(30),
        { id: 'island', lat: island.lat, lng: island.lon },
        { id: 'depot:d', lat: 45.02, lng: 5.02 },
      ]
      const m = await mod.buildValhallaMatrix(pts, undefined, { hubIds: ['depot:d'] })
      expect(m.degraded).toBe(false)
      expect(m.distance(m.indexOf('island'), 3)).toBeGreaterThan(0)
      expect(v.seen.length).toBeLessThan(12)
      v.spy.mockClear()
      await mod.buildValhallaMatrix(points) // breaker closed
      expect(v.spy).toHaveBeenCalled()
    })

    it('shrinks its requests when Valhalla is configured with a smaller pair limit', async () => {
      const v = fakeValhalla({
        reject: body =>
          body.sources.length * body.targets.length > 400 ? { status: 400, error_code: 150 } : null,
      })
      const { buildValhallaMatrix } = await import('../valhallaMatrix')
      const m = await buildValhallaMatrix(grid(100))
      expect(m.coverage).toBe(1)
      expect(m.degraded).toBe(false)
      expect(v.seen.some(b => b.sources.length * b.targets.length <= 400)).toBe(true)
    })
  })

  it('keeps working in this process when Redis refuses the write (memory full, noeviction)', async () => {
    redisState.available = true
    redisState.failWrites = true
    const v = fakeValhalla()
    const mod = await import('../valhallaMatrix')
    const m = await mod.buildValhallaMatrix(grid(50), undefined, { scope: 'full' })
    expect(m.coverage).toBe(1)
    expect(redisStore.size).toBe(0)
    v.spy.mockClear()
    await mod.buildValhallaMatrix(grid(50), undefined, { scope: 'full' })
    expect(v.spy).not.toHaveBeenCalled() // in-process copy
  })

  it('retries once, with fewer requests in flight, before declaring Valhalla down', async () => {
    let calls = 0
    const v = fakeValhalla({ reject: () => (++calls === 2 ? { status: 503 } : null) })
    const { buildValhallaMatrix } = await import('../valhallaMatrix')
    const m = await buildValhallaMatrix(grid(120))
    expect(m.degraded).toBe(false)
    expect(m.coverage).toBe(1)
    expect(v.seen.length).toBeGreaterThan(9)
  })
})
