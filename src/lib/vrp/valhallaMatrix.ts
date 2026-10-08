import { createHash } from 'node:crypto'
import type { VehicleDimensions } from '@/lib/types'
import { createLogger } from '@/lib/logger'
import { cachedDist, haversineKm } from './distanceCache'
import { trafficFactor } from '@/lib/algorithm'

const log = createLogger('valhallaMatrix')

/**
 * Road matrix from Valhalla (truck costing).
 *
 * What the measurements showed (PERFORMANCE_BENCHMARKS.md): a matrix cell costs Valhalla roughly
 * 0.4–0.7 ms of CPU whatever the request shape, so the only way to be fast is to ask for fewer
 * cells. This module therefore
 *  - works on unique coordinates (several missions on one site are one location);
 *  - keeps every cell it ever obtained, per organisation and vehicle profile, in memory and in
 *    Redis (binary), and only asks Valhalla for the cells it does not know yet — adding one
 *    mission to yesterday's 170 points is ~340 cells, not 28 900;
 *  - groups points into compact geographic blocks and fetches depots/outlets first, then each
 *    block, then pairs of blocks from nearest to farthest: when the time budget runs out, the
 *    real distances are the ones the search actually uses;
 *  - fills what is missing with straight-line distances calibrated on the real cells of the same
 *    matrix (detour ratio and speed), never with a mix of two unrelated scales;
 *  - finishes a matrix that ran out of budget in the background, so the next run is complete;
 *  - never opens the circuit breaker because a budget ran out or one address is off the road
 *    network — only when Valhalla itself fails.
 */

// Valhalla rejects a request whose sources x targets product exceeds max_matrix_location_pairs
// (2500 by default): 48 x 48 = 2304. Measured cost of a request ≈ a·(sources + targets) + b·cells,
// where "a" grows with the distance the searches have to cover: large, compact blocks are the
// cheapest way to buy cells (0.2 ms per cell for neighbours, 1.4 ms for points picked at random).
const DEFAULT_BLOCK = 48
const MAX_BLOCK = 50
const MAX_PAIRS = 2304
/** Locations in one request (the memory of a Valhalla search grows with them). */
const MAX_LOCATIONS = 100
const BREAKER_OPEN_MS = 60_000
/** Longest a build waits past its budget for the requests already in flight. */
const DEADLINE_GRACE_MS = 1_500
/** Above this many points the matrix is read block by block instead of from one flat array. */
const DENSE_MAX_POINTS = 2600
const SNAPSHOTS_PER_STORE = 3
const SNAPSHOT_VERSION = 3
/** In-process copy of the stores: bounded, least recently used first out. */
const L1_MAX_CELLS = 6_000_000

/** Cell states inside a block: NaN = not asked yet, NO_ROUTE = Valhalla found no road, >= 0 = real. */
const NO_ROUTE = -1

function envInt(name: string, fallback: number, min: number, max: number): number {
  const v = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback
}

function getValhallaUrl(): string {
  return process.env.VALHALLA_URL || process.env.VALHALLA_FALLBACK_URL || ''
}
const getTimeoutMs = () => envInt('VALHALLA_TIMEOUT_MS', 15_000, 500, 120_000)
/** Hard cap on what one optimisation waits for its matrix; the rest is estimated, then completed in the background. */
const getBudgetMs = () => envInt('VALHALLA_MATRIX_BUDGET_MS', 20_000, 500, 600_000)
const getBlockSize = () => envInt('VALHALLA_MATRIX_BLOCK', DEFAULT_BLOCK, 5, MAX_BLOCK)
/** Requests in flight for the whole process — match it to the Valhalla service's thread count. */
const getMaxConcurrent = () => envInt('VALHALLA_MAX_CONCURRENT', 4, 1, 32)
const getCacheTtlS = () => envInt('VALHALLA_CACHE_TTL_S', 7 * 86_400, 60, 90 * 86_400)
/** Largest matrix kept in Redis (8 bytes per cell): 1.5 M cells = 12 MB. */
const getCacheMaxCells = () => envInt('VALHALLA_CACHE_MAX_CELLS', 1_500_000, 0, 50_000_000)
/** Time allowed to finish, after the response, a matrix that ran out of budget. 0 disables. */
const getBackgroundMs = () =>
  envInt('VALHALLA_BACKGROUND_MS', process.env.NODE_ENV === 'test' ? 0 : 180_000, 0, 3_600_000)

export interface GeoPoint {
  id: string
  lat: number
  lng: number
}

export interface ValhallaMatrix {
  source: 'valhalla' | 'valhalla-chunked' | 'haversine'

  /** True when some cells are calibrated estimates because Valhalla failed or the budget ran out. */
  degraded?: boolean

  /** Share (0–1) of the cells that are real road distances. */
  coverage?: number

  size: number

  indexOf: (_pointId: string) => number

  distance: (_fromIdx: number, _toIdx: number) => number

  duration: (_fromIdx: number, _toIdx: number) => number
}

export interface ValhallaMatrixOptions {
  /** Cache partition — the organisation id. Matrices are never looked up across scopes. */
  scope?: string
  /** Points every route goes through (depots, outlets): fetched first, against every other point. */
  hubIds?: Iterable<string>
  /** Overrides VALHALLA_MATRIX_BUDGET_MS for this build. */
  budgetMs?: number
}

/** What the last build did — read by the benchmark and the tests. */
export interface ValhallaBuildStats {
  points: number
  uniquePoints: number
  blocks: number
  requests: number
  fetchedCells: number
  reusedCells: number
  totalCells: number
  coverage: number
  degraded: boolean
  unreachablePoints: number
  cacheHit: boolean
  ms: number
}

let _lastStats: ValhallaBuildStats | null = null
export function _lastValhallaBuild(): ValhallaBuildStats | null {
  return _lastStats
}
/** True while a matrix is being completed in the background (benchmark, tests). */
export function _valhallaBackgroundActive(): boolean {
  return _backgroundRunning > 0
}

const DEFAULT_DIMENSIONS: VehicleDimensions = {
  weightTon: 26,
  heightM: 4.0,
  widthM: 2.55,
  lengthM: 12.0,
  axleCount: 3,
  hazmat: false,
}

function buildCostingOptions(dims: VehicleDimensions) {
  return {
    truck: {
      weight: dims.weightTon,
      height: dims.heightM,
      width: dims.widthM,
      length: dims.lengthM,
      axle_count: dims.axleCount,
      hazmat: dims.hazmat,
      use_highways: 0.8,
      use_tolls: 0.5,
    },
  }
}

// ── Circuit breaker ─────────────────────────────────────────────────────────

let _breakerOpenUntil = 0

function breakerOpen(): boolean {
  return Date.now() < _breakerOpenUntil
}
function tripBreaker(reason: string): void {
  _breakerOpenUntil = Date.now() + BREAKER_OPEN_MS
  log.warn('Valhalla unavailable — using straight-line distances for the next minute', { reason })
}

// ── Process-wide request limiter ────────────────────────────────────────────

/**
 * One limiter for every matrix built in this process: three optimisations at once must not turn
 * into twelve concurrent searches on a Valhalla that has four threads. Background completion only
 * takes a slot nobody in the foreground is waiting for, and never more than half of them.
 */
const limiter = {
  active: 0,
  activeBackground: 0,
  /** Lowered after a transient failure, raised again on success. */
  limit: 0,
  waiting: [] as Array<() => void>,
  waitingBackground: [] as Array<() => void>,
}

function limiterCap(): number {
  const max = getMaxConcurrent()
  if (limiter.limit <= 0 || limiter.limit > max) limiter.limit = max
  return limiter.limit
}

function pumpLimiter(): void {
  const cap = limiterCap()
  while (limiter.active < cap && limiter.waiting.length > 0) {
    limiter.active++
    limiter.waiting.shift()!()
  }
  const bgCap = Math.max(1, Math.floor(cap / 2))
  while (
    limiter.waiting.length === 0 &&
    limiter.active < cap &&
    limiter.activeBackground < bgCap &&
    limiter.waitingBackground.length > 0
  ) {
    limiter.active++
    limiter.activeBackground++
    limiter.waitingBackground.shift()!()
  }
}

function acquireSlot(background: boolean): Promise<void> {
  return new Promise(resolve => {
    ;(background ? limiter.waitingBackground : limiter.waiting).push(resolve)
    pumpLimiter()
  })
}

function releaseSlot(background: boolean): void {
  limiter.active--
  if (background) limiter.activeBackground--
  pumpLimiter()
}

// ── Layout: unique coordinates grouped into compact blocks ──────────────────

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`
}

interface Layout {
  /** Unique coordinates. */
  n: number
  keys: string[]
  lat: Float64Array
  lng: Float64Array
  hub: Uint8Array
  /** Blocks made only of hubs (fetched first). */
  hubBlock: Uint8Array
  /** Unique index u belongs to block blockOfPoint[u]; block b is the range start[b]..start[b+1]. */
  K: number
  blockOfPoint: Int32Array
  start: Int32Array
}

/**
 * The layout depends only on the SET of coordinates (and which are hubs), never on the order the
 * caller listed them in: two runs over the same addresses build the same blocks.
 */
function buildLayout(
  coords: Map<string, { lat: number; lng: number; hub: boolean }>,
  block: number,
): Layout {
  const keysSorted = [...coords.keys()].sort()
  const n = keysSorted.length
  const lat0 = new Float64Array(n)
  const lng0 = new Float64Array(n)
  const hubs: number[] = []
  const others: number[] = []
  for (let i = 0; i < n; i++) {
    const c = coords.get(keysSorted[i])!
    lat0[i] = c.lat
    lng0[i] = c.lng
    if (c.hub) hubs.push(i)
    else others.push(i)
  }

  const groups: number[][] = []
  // Depots and outlets get their own block (fetched first, against everything) once there are
  // enough mission blocks for that to be a small extra; below, the extra thin requests would
  // cost more than they bring and hubs simply stay with their neighbours.
  const hubsApart = hubs.length > 0 && others.length > 3 * block
  if (hubsApart) {
    for (let i = 0; i < hubs.length; i += block) groups.push(hubs.slice(i, i + block))
  } else {
    others.push(...hubs)
    others.sort((a, b) => a - b)
  }

  // Recursive bisection along the wider side: compact blocks of at most `block` points.
  const split = (idx: number[]): void => {
    if (idx.length === 0) return
    if (idx.length <= block) {
      groups.push(idx)
      return
    }
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity
    for (const i of idx) {
      if (lat0[i] < minLat) minLat = lat0[i]
      if (lat0[i] > maxLat) maxLat = lat0[i]
      if (lng0[i] < minLng) minLng = lng0[i]
      if (lng0[i] > maxLng) maxLng = lng0[i]
    }
    const lngScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
    const byLat = maxLat - minLat >= (maxLng - minLng) * lngScale
    idx.sort((a, b) => (byLat ? lat0[a] - lat0[b] : lng0[a] - lng0[b]) || a - b)
    // Cut so that the number of blocks stays minimal and they come out the same size.
    const blocksNeeded = Math.ceil(idx.length / block)
    const cut = Math.min(
      idx.length - 1,
      Math.ceil(blocksNeeded / 2) * Math.ceil(idx.length / blocksNeeded),
    )
    split(idx.slice(0, cut))
    split(idx.slice(cut))
  }
  split(others)

  const keys: string[] = new Array(n)
  const lat = new Float64Array(n)
  const lng = new Float64Array(n)
  const hub = new Uint8Array(n)
  const blockOfPoint = new Int32Array(n)
  const start = new Int32Array(groups.length + 1)
  const hubBlock = new Uint8Array(groups.length)
  let u = 0
  for (let b = 0; b < groups.length; b++) {
    start[b] = u
    for (const i of groups[b]) {
      keys[u] = keysSorted[i]
      lat[u] = lat0[i]
      lng[u] = lng0[i]
      hub[u] = coords.get(keysSorted[i])!.hub ? 1 : 0
      hubBlock[b] = hubsApart && hub[u] ? 1 : 0
      blockOfPoint[u] = b
      u++
    }
  }
  start[groups.length] = n
  return { n, keys, lat, lng, hub, hubBlock, K: groups.length, blockOfPoint, start }
}

// ── Block-sparse matrix ─────────────────────────────────────────────────────

/** Only the block pairs that hold at least one cell are allocated; a cell is NaN until known. */
class BlockMatrix {
  readonly table: Int32Array
  dist: Float32Array[] = []
  dur: Float32Array[] = []
  private owned: boolean[] = []
  /** Cells holding a real value or NO_ROUTE. */
  known = 0

  constructor(readonly L: Layout) {
    this.table = new Int32Array(L.K * L.K).fill(-1)
  }

  blockSize(b: number): number {
    return this.L.start[b + 1] - this.L.start[b]
  }

  private slot(a: number, b: number): number {
    const t = a * this.L.K + b
    let s = this.table[t]
    if (s < 0) {
      const cells = this.blockSize(a) * this.blockSize(b)
      s = this.dist.length
      this.dist.push(new Float32Array(cells).fill(NaN))
      this.dur.push(new Float32Array(cells).fill(NaN))
      this.owned.push(true)
      this.table[t] = s
    } else if (!this.owned[s]) {
      this.dist[s] = Float32Array.from(this.dist[s])
      this.dur[s] = Float32Array.from(this.dur[s])
      this.owned[s] = true
    }
    return s
  }

  /** NaN when unknown, NO_ROUTE when Valhalla found no road, the distance in km otherwise. */
  rawDist(u: number, v: number): number {
    const a = this.L.blockOfPoint[u],
      b = this.L.blockOfPoint[v]
    const s = this.table[a * this.L.K + b]
    if (s < 0) return NaN
    return this.dist[s][(u - this.L.start[a]) * this.blockSize(b) + (v - this.L.start[b])]
  }

  rawDur(u: number, v: number): number {
    const a = this.L.blockOfPoint[u],
      b = this.L.blockOfPoint[v]
    const s = this.table[a * this.L.K + b]
    if (s < 0) return NaN
    return this.dur[s][(u - this.L.start[a]) * this.blockSize(b) + (v - this.L.start[b])]
  }

  set(u: number, v: number, d: number, t: number): void {
    const a = this.L.blockOfPoint[u],
      b = this.L.blockOfPoint[v]
    const s = this.slot(a, b)
    const i = (u - this.L.start[a]) * this.blockSize(b) + (v - this.L.start[b])
    if (Number.isNaN(this.dist[s][i])) this.known++
    this.dist[s][i] = d
    this.dur[s][i] = t
  }

  hasBlock(a: number, b: number): boolean {
    return this.table[a * this.L.K + b] >= 0
  }

  /** Registers a block read from storage; its arrays belong to this object. */
  adoptBlock(a: number, b: number, d: Float32Array, t: Float32Array): void {
    this.table[a * this.L.K + b] = this.dist.length
    this.dist.push(d)
    this.dur.push(t)
    this.owned.push(true)
    for (let i = 0; i < d.length; i++) if (!Number.isNaN(d[i])) this.known++
  }

  /** A copy that shares every block until it writes to it. */
  fork(): BlockMatrix {
    const m = new BlockMatrix(this.L)
    m.table.set(this.table)
    m.dist = [...this.dist]
    m.dur = [...this.dur]
    m.owned = this.dist.map(() => false)
    m.known = this.known
    return m
  }

  /** Copies into this matrix every cell of `from` whose two ends exist here. Returns the count. */
  seedFrom(from: BlockMatrix): number {
    const here = new Map<string, number>()
    for (let u = 0; u < this.L.n; u++) here.set(this.L.keys[u], u)
    const to = new Int32Array(from.L.n).fill(-1)
    let any = false
    for (let s = 0; s < from.L.n; s++) {
      const u = here.get(from.L.keys[s])
      if (u !== undefined) {
        to[s] = u
        any = true
      }
    }
    if (!any) return 0
    let copied = 0
    const K = from.L.K
    for (let a = 0; a < K; a++) {
      for (let b = 0; b < K; b++) {
        const s = from.table[a * K + b]
        if (s < 0) continue
        const w = from.blockSize(b)
        const d = from.dist[s],
          t = from.dur[s]
        for (let r = from.L.start[a]; r < from.L.start[a + 1]; r++) {
          const u = to[r]
          if (u < 0) continue
          const row = (r - from.L.start[a]) * w
          for (let c = from.L.start[b]; c < from.L.start[b + 1]; c++) {
            const v = to[c]
            if (v < 0) continue
            const val = d[row + (c - from.L.start[b])]
            if (Number.isNaN(val) || !Number.isNaN(this.rawDist(u, v))) continue
            this.set(u, v, val, t[row + (c - from.L.start[b])])
            copied++
          }
        }
      }
    }
    return copied
  }
}

// ── Snapshots: in-process (L1) and Redis (L2) ───────────────────────────────

interface Snapshot {
  id: string
  matrix: BlockMatrix
}

const l1 = new Map<string, Snapshot[]>()

function l1Get(store: string): Snapshot[] {
  const s = l1.get(store)
  if (!s) return []
  l1.delete(store)
  l1.set(store, s) // most recently used last
  return s
}

function l1Put(store: string, snaps: Snapshot[]): void {
  l1.delete(store)
  l1.set(store, snaps)
  let total = 0
  for (const list of l1.values()) for (const s of list) total += s.matrix.known
  for (const key of [...l1.keys()]) {
    if (total <= L1_MAX_CELLS || key === store) continue
    for (const s of l1.get(key)!) total -= s.matrix.known
    l1.delete(key)
  }
}

function dimsKey(dims: VehicleDimensions): string {
  return [
    dims.weightTon,
    dims.heightM,
    dims.widthM,
    dims.lengthM,
    dims.axleCount,
    dims.hazmat,
  ].join(':')
}

function storeKey(scope: string | undefined, dims: VehicleDimensions): string {
  const h = createHash('sha256')
    .update(`${SNAPSHOT_VERSION}|${scope ?? ''}|${dimsKey(dims)}`)
    .digest('hex')
    .slice(0, 32)
  return `valhalla:snap:${h}`
}

/**
 * Identity of one matrix request: the set of coordinates and the vehicle profile, not the order
 * of the points (the same addresses come back in another order from one run to the next).
 */
export function matrixCacheKey(points: GeoPoint[], dims: VehicleDimensions): string {
  const coords = [...new Set(points.map(p => coordKey(p.lat, p.lng)))].sort()
  const input = [`v${SNAPSHOT_VERSION}`, coords.join('|'), dimsKey(dims)].join(':')
  return `valhalla:matrix:${createHash('sha256').update(input).digest('hex').slice(0, 40)}`
}

function encodeSnapshot(m: BlockMatrix, maxCells: number): Buffer | null {
  const L = m.L
  const blocks: Array<[number, number]> = []
  const parts: Float32Array[] = []
  let cells = 0
  for (let a = 0; a < L.K; a++) {
    for (let b = 0; b < L.K; b++) {
      const s = m.table[a * L.K + b]
      if (s < 0) continue
      const size = m.dist[s].length
      if (cells + size > maxCells) continue
      cells += size
      blocks.push([a, b])
      parts.push(m.dist[s], m.dur[s])
    }
  }
  if (blocks.length === 0) return null
  const sizes: number[] = []
  for (let b = 0; b < L.K; b++) sizes.push(m.blockSize(b))
  const header = Buffer.from(
    JSON.stringify({ v: SNAPSHOT_VERSION, keys: L.keys, sizes, blocks }),
    'utf8',
  )
  const pad = (4 - ((4 + header.length) % 4)) % 4
  const out = Buffer.alloc(4 + header.length + pad + cells * 8)
  out.writeUInt32LE(header.length, 0)
  header.copy(out, 4)
  let off = 4 + header.length + pad
  for (const p of parts) {
    Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(out, off)
    off += p.byteLength
  }
  return out
}

function decodeSnapshot(buf: Buffer): BlockMatrix | null {
  try {
    const hl = buf.readUInt32LE(0)
    const header = JSON.parse(buf.subarray(4, 4 + hl).toString('utf8')) as {
      v: number
      keys: string[]
      sizes: number[]
      blocks: Array<[number, number]>
    }
    if (header.v !== SNAPSHOT_VERSION) return null
    const n = header.keys.length
    const K = header.sizes.length
    const start = new Int32Array(K + 1)
    const blockOfPoint = new Int32Array(n)
    let u = 0
    for (let b = 0; b < K; b++) {
      start[b] = u
      for (let i = 0; i < header.sizes[b]; i++) blockOfPoint[u++] = b
    }
    start[K] = u
    if (u !== n) return null
    // A stored snapshot is only matched by coordinate key: lat/lng/hub are not needed again.
    const L: Layout = {
      n,
      keys: header.keys,
      lat: new Float64Array(0),
      lng: new Float64Array(0),
      hub: new Uint8Array(0),
      hubBlock: new Uint8Array(K),
      K,
      blockOfPoint,
      start,
    }
    const m = new BlockMatrix(L)
    let off = 4 + hl + ((4 - ((4 + hl) % 4)) % 4)
    for (const [a, b] of header.blocks) {
      const cells = header.sizes[a] * header.sizes[b]
      const bytes = cells * 4
      if (off + 2 * bytes > buf.length) return null
      const d = new Float32Array(cells)
      const t = new Float32Array(cells)
      new Uint8Array(d.buffer).set(buf.subarray(off, off + bytes))
      off += bytes
      new Uint8Array(t.buffer).set(buf.subarray(off, off + bytes))
      off += bytes
      m.adoptBlock(a, b, d, t)
    }
    return m
  } catch {
    return null
  }
}

type RedisLike = {
  get(_key: string): Promise<string | null>
  getBuffer(_key: string): Promise<Buffer | null>
  set(_key: string, _value: string | Buffer, _mode: 'EX', _ttl: number): Promise<unknown>
  del(..._keys: string[]): Promise<unknown>
  expire(_key: string, _ttl: number): Promise<unknown>
}

async function redis(): Promise<RedisLike | null> {
  try {
    const { getRedisClient, REDIS_AVAILABLE } = await import('@/lib/redisClient')
    if (!REDIS_AVAILABLE) return null
    return (await getRedisClient()) as unknown as RedisLike | null
  } catch {
    return null
  }
}

/** Snapshots of a store, newest first. Redis is only read for snapshots this process doesn't hold. */
async function loadSnapshots(store: string): Promise<Snapshot[]> {
  const local = l1Get(store)
  const client = await redis()
  if (!client) return local
  try {
    const raw = await client.get(`${store}:idx`)
    if (!raw) return local
    const ids = (JSON.parse(raw) as Array<{ id: string }>)
      .map(e => e.id)
      .slice(0, SNAPSHOTS_PER_STORE)
    const byId = new Map(local.map(s => [s.id, s]))
    const out: Snapshot[] = []
    for (const id of ids) {
      const have = byId.get(id)
      if (have) {
        out.push(have)
        continue
      }
      const buf = await client.getBuffer(`${store}:${id}`)
      const matrix = buf ? decodeSnapshot(buf) : null
      if (matrix) out.push({ id, matrix })
    }
    // Local snapshots Redis doesn't list (written while Redis was down, or too big for it) stay usable.
    for (const s of local) if (!ids.includes(s.id)) out.push(s)
    const kept = out.slice(0, SNAPSHOTS_PER_STORE + 1)
    l1Put(store, kept)
    return kept
  } catch {
    return local
  }
}

/**
 * Saves the matrix as the store's newest snapshot. Older snapshots whose coordinates are all in
 * the new one were copied into it and are dropped; the others (other days' customers) are kept,
 * up to SNAPSHOTS_PER_STORE.
 */
async function saveSnapshot(store: string, m: BlockMatrix, previous: Snapshot[]): Promise<void> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const mine = new Set(m.L.keys)
  const kept = previous
    .filter(s => s.matrix.L.keys.some(k => !mine.has(k)))
    .slice(0, SNAPSHOTS_PER_STORE - 1)
  const dropped = previous.filter(s => !kept.includes(s))
  l1Put(store, [{ id, matrix: m }, ...kept])

  const client = await redis()
  if (!client) return
  try {
    const maxCells = getCacheMaxCells()
    const buf = maxCells > 0 ? encodeSnapshot(m, maxCells) : null
    if (!buf) return
    const ttl = getCacheTtlS()
    await client.set(`${store}:${id}`, buf, 'EX', ttl)
    await client.set(
      `${store}:idx`,
      JSON.stringify([{ id }, ...kept.map(s => ({ id: s.id }))]),
      'EX',
      ttl,
    )
    if (dropped.length > 0) await client.del(...dropped.map(s => `${store}:${s.id}`))
  } catch (err) {
    // A full Redis (noeviction) refuses the write: the matrix stays in this process only.
    log.warn('Valhalla matrix not saved to Redis', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

async function touchSnapshots(store: string, snaps: Snapshot[]): Promise<void> {
  const client = await redis()
  if (!client) return
  try {
    const ttl = getCacheTtlS()
    await client.expire(`${store}:idx`, ttl)
    for (const s of snaps.slice(0, SNAPSHOTS_PER_STORE))
      await client.expire(`${store}:${s.id}`, ttl)
  } catch {
    /* cache only */
  }
}

// ── Valhalla requests ───────────────────────────────────────────────────────

/**
 * transient: Valhalla itself (network, 5xx, timeout) · limit: request above the service's pair
 * limit · noroute: Valhalla found no path for any pair of the request · location: a location it
 * refuses (no road nearby, too far away) · deadline: the budget ran out.
 */
type FailureKind = 'transient' | 'limit' | 'noroute' | 'location' | 'deadline'

class ValhallaError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message)
  }
}

interface BlockAnswer {
  dist: Array<Array<number | null>>
  dur: Array<Array<number | null>>
}

async function requestCells(
  L: Layout,
  sources: number[],
  targets: number[],
  dims: VehicleDimensions,
  timeoutMs: number,
  deadline: number,
): Promise<BlockAnswer> {
  const body = {
    costing: 'truck',
    costing_options: buildCostingOptions(dims),
    sources: sources.map(u => ({ lat: L.lat[u], lon: L.lng[u] })),
    targets: targets.map(u => ({ lat: L.lat[u], lon: L.lng[u] })),
    // Compact answer (two number tables). Older Valhalla versions ignore the flag: both shapes are read.
    verbose: false,
  }
  let res: Response
  try {
    res = await fetch(`${getValhallaUrl()}/sources_to_targets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // An integer: AbortSignal.timeout() throws on a fractional delay.
      signal: AbortSignal.timeout(Math.max(250, Math.round(timeoutMs))),
    })
  } catch (err) {
    if (Date.now() >= deadline) throw new ValhallaError('deadline', 'budget exhausted')
    throw new ValhallaError('transient', err instanceof Error ? err.message : String(err))
  }

  if (!res.ok) {
    const text = typeof res.text === 'function' ? await res.text().catch(() => '') : ''
    let code = 0
    try {
      code = Number((JSON.parse(text) as { error_code?: number }).error_code) || 0
    } catch {
      /* not JSON */
    }
    // Codes observed on Valhalla 3.5: 150 = more pairs than max_matrix_location_pairs,
    // 442 = no path for any pair, 171 = no road near a location, 154 = a pair too far apart.
    // Every other 4xx is treated like 171/154: the caller narrows it down to the location.
    if (res.status === 400 && code === 150) throw new ValhallaError('limit', `Valhalla ${code}`)
    if (res.status === 400 && code === 442) throw new ValhallaError('noroute', `Valhalla ${code}`)
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      throw new ValhallaError('location', `Valhalla HTTP ${res.status}${code ? ` (${code})` : ''}`)
    }
    throw new ValhallaError('transient', `Valhalla HTTP ${res.status}`)
  }

  const data = (await res.json()) as {
    sources_to_targets?:
      | Array<Array<{ distance: number | null; time: number | null } | null>>
      | { distances?: Array<Array<number | null>>; durations?: Array<Array<number | null>> }
  }
  const st = data.sources_to_targets
  const dist: Array<Array<number | null>> = []
  const dur: Array<Array<number | null>> = []
  for (let i = 0; i < sources.length; i++) {
    const dRow: Array<number | null> = []
    const tRow: Array<number | null> = []
    for (let j = 0; j < targets.length; j++) {
      let d: number | null | undefined
      let t: number | null | undefined
      if (Array.isArray(st)) {
        const cell = st[i]?.[j]
        d = cell?.distance
        t = cell?.time
      } else {
        d = st?.distances?.[i]?.[j]
        t = st?.durations?.[i]?.[j]
      }
      const ok =
        typeof d === 'number' &&
        typeof t === 'number' &&
        Number.isFinite(d) &&
        Number.isFinite(t) &&
        d >= 0 &&
        d < 1e8
      dRow.push(ok ? (d as number) : null)
      tRow.push(ok ? (t as number) / 60 : null)
    }
    dist.push(dRow)
    dur.push(tRow)
  }
  return { dist, dur }
}

// ── Build engine ────────────────────────────────────────────────────────────

interface Core {
  L: Layout
  M: BlockMatrix
  dims: VehicleDimensions
  store: string
  /** Points left out of further requests and estimated: no depot or outlet reaches them, or Valhalla refuses them. */
  dead: Uint8Array
  /** Points that were part of an answered request: Valhalla accepts them as locations. */
  accepted: Uint8Array
  /** Times a point was alone in a refused request without ever being accepted. */
  refused: Uint8Array
  requests: number
  fetchedCells: number
  reusedCells: number
  /** Valhalla itself failed (not the budget, not an address). */
  failed: boolean
  /** Block pairs not processed when the engine stopped. */
  remaining: number
  blockSide: number
  /** Running average of a request's duration (ms): no request is started that the budget cannot wait for. */
  avgRequestMs: number
}

interface Unit {
  a: number
  b: number
  rank: number
}

/** Block pairs in the order they matter: hubs first, then each block, then nearest pairs first. */
function planUnits(L: Layout): Unit[] {
  const K = L.K
  const cLat = new Float64Array(K)
  const cLng = new Float64Array(K)
  const isHub = new Uint8Array(K)
  for (let b = 0; b < K; b++) {
    let sLat = 0,
      sLng = 0
    for (let u = L.start[b]; u < L.start[b + 1]; u++) {
      sLat += L.lat[u]
      sLng += L.lng[u]
    }
    const size = L.start[b + 1] - L.start[b]
    cLat[b] = sLat / size
    cLng[b] = sLng / size
    isHub[b] = L.hubBlock[b]
  }
  const units: Unit[] = []
  for (let a = 0; a < K; a++) {
    for (let b = 0; b < K; b++) {
      // Each block against itself comes first: neighbours are the legs a route is mostly made
      // of and by far the cheapest cells (short searches). Then depots and outlets against
      // everything (every route goes through them; these searches cross the whole area), then
      // pairs of blocks from the nearest to the farthest.
      const rank =
        isHub[a] || isHub[b]
          ? -1
          : a === b
            ? -2
            : haversineKm(cLat[a], cLng[a], cLat[b], cLng[b]) + 0.001
      units.push({ a, b, rank })
    }
  }
  units.sort((x, y) => x.rank - y.rank || x.a - y.a || x.b - y.b)
  return units
}

/** The requests that fill the unknown cells of one block pair, asking for as few locations as possible. */
function unitRequests(core: Core, unit: Unit): Array<{ sources: number[]; targets: number[] }> {
  const { L, M, dead } = core
  const rows: number[] = []
  const cols: number[] = []
  for (let u = L.start[unit.a]; u < L.start[unit.a + 1]; u++) if (!dead[u]) rows.push(u)
  for (let v = L.start[unit.b]; v < L.start[unit.b + 1]; v++) if (!dead[v]) cols.push(v)
  if (rows.length === 0 || cols.length === 0) return []

  const missingByRow: number[][] = []
  let any = false
  const fresh = !M.hasBlock(unit.a, unit.b)
  for (const u of rows) {
    const miss: number[] = []
    for (const v of cols) {
      if (u === v) continue
      if (fresh || Number.isNaN(M.rawDist(u, v))) miss.push(v)
    }
    missingByRow.push(miss)
    if (miss.length > 0) any = true
  }
  if (!any) return []

  // Rows that are mostly unknown (new points) go together; the rows that only miss a few columns
  // (the columns of those new points) form a second, thin request.
  const heavy: number[] = [],
    light: number[] = []
  rows.forEach((_u, i) => {
    if (missingByRow[i].length === 0) return
    ;(missingByRow[i].length * 2 > cols.length ? heavy : light).push(i)
  })
  const out: Array<{ sources: number[]; targets: number[] }> = []
  for (const group of [heavy, light]) {
    if (group.length === 0) continue
    const tset = new Set<number>()
    for (const i of group) for (const v of missingByRow[i]) tset.add(v)
    const sources = group.map(i => rows[i])
    const targets = cols.filter(v => tset.has(v))
    // Respect the (possibly reduced) request side.
    for (let s = 0; s < sources.length; s += core.blockSide) {
      for (let t = 0; t < targets.length; t += core.blockSide) {
        out.push({
          sources: sources.slice(s, s + core.blockSide),
          targets: targets.slice(t, t + core.blockSide),
        })
      }
    }
  }
  return out
}

function storeAnswer(core: Core, sources: number[], targets: number[], ans: BlockAnswer): void {
  for (const u of sources) core.accepted[u] = 1
  for (const v of targets) core.accepted[v] = 1
  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < targets.length; j++) {
      const u = sources[i],
        v = targets[j]
      if (u === v) continue
      const d = ans.dist[i][j],
        t = ans.dur[i][j]
      const was = core.M.rawDist(u, v)
      if (d === null || t === null) {
        if (Number.isNaN(was)) core.M.set(u, v, NO_ROUTE, NO_ROUTE)
      } else {
        core.M.set(u, v, d, t)
      }
      if (Number.isNaN(was)) core.fetchedCells++
    }
  }
}

/**
 * One request with its failure handling. An address Valhalla refuses fails the whole request:
 * it is narrowed down by halving until the offending cells are isolated and marked "no route".
 * Throws only for a failure of Valhalla itself or the end of the budget.
 */
async function fetchInto(
  core: Core,
  sources: number[],
  targets: number[],
  deadline: number,
  background: boolean,
  retried = false,
): Promise<void> {
  // A point set aside while this unit was being narrowed down is not asked again.
  if (sources.some(u => core.dead[u])) sources = sources.filter(u => !core.dead[u])
  if (targets.some(v => core.dead[v])) targets = targets.filter(v => !core.dead[v])
  if (sources.length === 0 || targets.length === 0) return
  if (Date.now() >= deadline) throw new ValhallaError('deadline', 'budget exhausted')
  await acquireSlot(background)
  let ans: BlockAnswer
  try {
    // A request abandoned at the deadline is lost work that still occupies a Valhalla thread:
    // none is started that is not expected to finish in what is left of the budget (plus a
    // short grace, so the last ones in flight are kept rather than thrown away).
    const left = deadline - Date.now()
    if (left <= 0 || (!background && left < core.avgRequestMs * 0.7))
      throw new ValhallaError('deadline', 'budget exhausted')
    const grace = Math.min(DEADLINE_GRACE_MS, Math.max(250, core.avgRequestMs))
    const timeout = background ? getTimeoutMs() : Math.min(getTimeoutMs(), left + grace)
    core.requests++
    const sentAt = Date.now()
    ans = await requestCells(
      core.L,
      sources,
      targets,
      core.dims,
      timeout,
      background ? Infinity : deadline,
    )
    const took = Date.now() - sentAt
    core.avgRequestMs = core.avgRequestMs === 0 ? took : core.avgRequestMs * 0.7 + took * 0.3
    if (limiter.limit < getMaxConcurrent()) limiter.limit++
  } catch (err) {
    releaseSlot(background)
    const failure =
      err instanceof ValhallaError
        ? err
        : new ValhallaError('transient', err instanceof Error ? err.message : String(err))
    if (failure.kind === 'limit' && sources.length * targets.length > 1) {
      core.blockSide = Math.max(1, Math.floor(Math.max(sources.length, targets.length) / 2))
      return splitAndFetch(core, sources, targets, deadline, background)
    }
    if (failure.kind === 'noroute' || failure.kind === 'limit') {
      markNoRoute(core, sources, targets)
      return
    }
    if (failure.kind === 'location') {
      if (sources.length * targets.length > 1)
        return splitAndFetch(core, sources, targets, deadline, background)
      markNoRoute(core, sources, targets)
      // Which of the two is the refused location? The one Valhalla never accepted elsewhere.
      // Three refusals and it is set aside for the rest of the build.
      for (const u of [sources[0], targets[0]]) {
        if (core.accepted[u] || core.L.hub[u]) continue
        if (core.refused[u] < 255) core.refused[u]++
        if (core.refused[u] >= 3) core.dead[u] = 1
      }
      return
    }
    if (failure.kind === 'transient' && !retried) {
      // Back off before giving up: Valhalla may only be saturated.
      limiter.limit = Math.max(1, Math.floor(limiterCap() / 2))
      return fetchInto(core, sources, targets, deadline, background, true)
    }
    throw failure
  }
  releaseSlot(background)
  storeAnswer(core, sources, targets, ans)
}

function markNoRoute(core: Core, sources: number[], targets: number[]): void {
  for (const u of sources) {
    for (const v of targets) {
      if (u === v || !Number.isNaN(core.M.rawDist(u, v))) continue
      core.M.set(u, v, NO_ROUTE, NO_ROUTE)
      core.fetchedCells++
    }
  }
}

async function splitAndFetch(
  core: Core,
  sources: number[],
  targets: number[],
  deadline: number,
  background: boolean,
): Promise<void> {
  if (sources.length >= targets.length) {
    const h = Math.ceil(sources.length / 2)
    await fetchInto(core, sources.slice(0, h), targets, deadline, background)
    await fetchInto(core, sources.slice(h), targets, deadline, background)
  } else {
    const h = Math.ceil(targets.length / 2)
    await fetchInto(core, sources, targets.slice(0, h), deadline, background)
    await fetchInto(core, sources, targets.slice(h), deadline, background)
  }
}

/** A point is unreachable when no hub can reach it and it can reach no hub. */
function markUnreachable(core: Core): void {
  const { L, M, dead } = core
  const hubs: number[] = []
  for (let u = 0; u < L.n; u++) if (L.hub[u]) hubs.push(u)
  if (hubs.length === 0) return
  const candidates: number[] = []
  for (let u = 0; u < L.n; u++) {
    if (L.hub[u]) continue
    let answered = 0,
      routed = 0
    for (const h of hubs) {
      const out = M.rawDist(h, u),
        back = M.rawDist(u, h)
      if (!Number.isNaN(out)) {
        answered++
        if (out >= 0) routed++
      }
      if (!Number.isNaN(back)) {
        answered++
        if (back >= 0) routed++
      }
    }
    if (answered > 0 && routed === 0) candidates.push(u)
  }
  // More than half of the points "unreachable" means the hub is the problem, not the points.
  if (candidates.length * 2 > L.n - hubs.length) return
  for (const u of candidates) dead[u] = 1
}

/**
 * New points among known ones (missions added since the last run, new sites the next day): their
 * rows and columns are asked in a few long, thin requests — [new points] x [everything] and
 * [known points] x [new points] — instead of one small request per block pair. A request costs
 * mostly per location: this is about three times fewer searches for the same cells.
 */
function incrementalRequests(core: Core): Array<{ sources: number[]; targets: number[] }> {
  const { L, M } = core
  if (M.known === 0) return []
  const knownInRow = new Int32Array(L.n)
  for (let a = 0; a < L.K; a++) {
    for (let b = 0; b < L.K; b++) {
      const slot = M.table[a * L.K + b]
      if (slot < 0) continue
      const w = M.blockSize(b)
      const d = M.dist[slot]
      for (let i = 0; i < d.length; i++)
        if (!Number.isNaN(d[i])) knownInRow[L.start[a] + Math.floor(i / w)]++
    }
  }
  const fresh: number[] = [],
    known: number[] = []
  for (let u = 0; u < L.n; u++) (knownInRow[u] === 0 ? fresh : known).push(u)
  // Mostly new points is a cold build: compact blocks are the cheaper way.
  if (fresh.length === 0 || fresh.length * 2 > L.n) return []

  const out: Array<{ sources: number[]; targets: number[] }> = []
  const side = Math.min(fresh.length, 24)
  const other = Math.max(
    1,
    Math.min(MAX_LOCATIONS - side, Math.floor(MAX_PAIRS / side), core.blockSide * 2),
  )
  const all = [...known, ...fresh].sort((x, y) => x - y) // layout order: neighbours stay together
  for (let i = 0; i < fresh.length; i += side) {
    const group = fresh.slice(i, i + side)
    for (let j = 0; j < all.length; j += other)
      out.push({ sources: group, targets: all.slice(j, j + other) })
    for (let j = 0; j < known.length; j += other)
      out.push({ sources: known.slice(j, j + other), targets: group })
  }
  return out
}

async function runEngine(core: Core, deadline: number, background: boolean): Promise<void> {
  const units = planUnits(core.L)
  let next = 0
  let stop: ValhallaError | null = null

  const thin = incrementalRequests(core)
  if (thin.length > 0) {
    let at = 0
    await Promise.all(
      Array.from({ length: Math.max(1, getMaxConcurrent()) }, async () => {
        while (!stop && at < thin.length) {
          const r = thin[at++]
          try {
            await fetchInto(core, r.sources, r.targets, deadline, background)
          } catch (err) {
            stop =
              stop ??
              (err instanceof ValhallaError ? err : new ValhallaError('transient', String(err)))
          }
        }
      }),
    )
  }

  let phaseEnd = units.findIndex(u => u.rank >= 0)
  if (phaseEnd < 0) phaseEnd = units.length

  const worker = async (limit: number): Promise<void> => {
    while (!stop && next < limit) {
      const index = next++
      for (const r of unitRequests(core, units[index])) {
        if (stop) return
        try {
          await fetchInto(core, r.sources, r.targets, deadline, background)
        } catch (err) {
          stop =
            stop ??
            (err instanceof ValhallaError ? err : new ValhallaError('transient', String(err)))
          return
        }
      }
    }
  }
  const width = Math.max(1, getMaxConcurrent())

  // Phase 1: everything touching a depot or an outlet. Then the points no hub can reach are set
  // aside: their searches are the slow ones (Valhalla explores the whole graph before giving up).
  if (!stop) await Promise.all(Array.from({ length: width }, () => worker(phaseEnd)))
  if (!stop) {
    next = phaseEnd
    markUnreachable(core)
    await Promise.all(Array.from({ length: width }, () => worker(units.length)))
  }

  const halted = stop as ValhallaError | null
  core.remaining = halted ? Math.max(1, units.length - next) : 0
  core.failed = halted !== null && halted.kind !== 'deadline'
  if (core.failed && !background) tripBreaker(halted!.message)
}

// ── Reading the result ──────────────────────────────────────────────────────

interface Calibration {
  factor: [number, number, number]
  speed: [number, number, number]
}

const DEFAULT_CALIBRATION: Calibration = { factor: [1.5, 1.35, 1.2], speed: [50, 50, 50] }

function band(hav: number): 0 | 1 | 2 {
  return hav < 5 ? 0 : hav < 20 ? 1 : 2
}

function median(values: number[]): number {
  values.sort((x, y) => x - y)
  return values[Math.floor(values.length / 2)]
}

/**
 * Detour ratio (road km / straight-line km) and speed, per distance band, measured on a sample of
 * the real cells. A band with too few samples takes the overall median, then the defaults.
 */
function calibrate(core: Core): Calibration {
  const { L, M } = core
  const ratios: number[][] = [[], [], []]
  const speeds: number[][] = [[], [], []]
  const stride = Math.max(1, Math.floor(M.known / 20_000))
  let seen = 0
  for (let a = 0; a < L.K; a++) {
    for (let b = 0; b < L.K; b++) {
      const s = M.table[a * L.K + b]
      if (s < 0) continue
      const w = M.blockSize(b)
      const d = M.dist[s],
        t = M.dur[s]
      for (let i = 0; i < d.length; i++) {
        if (!(d[i] > 0) || seen++ % stride !== 0) continue
        const u = L.start[a] + Math.floor(i / w),
          v = L.start[b] + (i % w)
        const hav = haversineKm(L.lat[u], L.lng[u], L.lat[v], L.lng[v])
        if (hav < 0.3) continue
        const k = band(hav)
        ratios[k].push(d[i] / hav)
        if (t[i] > 0) speeds[k].push(d[i] / (t[i] / 60))
      }
    }
  }
  const allR = ratios.flat(),
    allS = speeds.flat()
  const cal: Calibration = {
    factor: [...DEFAULT_CALIBRATION.factor],
    speed: [...DEFAULT_CALIBRATION.speed],
  }
  for (const k of [0, 1, 2] as const) {
    if (ratios[k].length >= 15) cal.factor[k] = median(ratios[k])
    else if (allR.length >= 15) cal.factor[k] = median([...allR])
    if (speeds[k].length >= 15) cal.speed[k] = median(speeds[k])
    else if (allS.length >= 15) cal.speed[k] = median([...allS])
    cal.factor[k] = Math.max(1, Math.min(3, cal.factor[k]))
    cal.speed[k] = Math.max(10, Math.min(110, cal.speed[k]))
  }
  return cal
}

function toMatrix(points: GeoPoint[], core: Core): ValhallaMatrix {
  const { L, M } = core
  const n = points.length
  const idxMap = new Map<string, number>()
  const uOfKey = new Map<string, number>()
  for (let u = 0; u < L.n; u++) uOfKey.set(L.keys[u], u)
  const uOf = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    idxMap.set(points[i].id, i)
    uOf[i] = uOfKey.get(coordKey(points[i].lat, points[i].lng))!
  }

  const cal = calibrate(core)
  const estimateKm = (u: number, v: number): number => {
    const hav = haversineKm(L.lat[u], L.lng[u], L.lat[v], L.lng[v])
    return hav * cal.factor[band(hav)]
  }
  const estimateMin = (u: number, v: number): number => {
    const hav = haversineKm(L.lat[u], L.lng[u], L.lat[v], L.lng[v])
    const k = band(hav)
    return ((hav * cal.factor[k]) / cal.speed[k]) * 60
  }

  let real = 0
  for (let s = 0; s < M.dist.length; s++) {
    const d = M.dist[s]
    for (let i = 0; i < d.length; i++) if (d[i] >= 0) real++
  }
  const total = L.n * (L.n - 1)
  const coverage = total > 0 ? Math.min(1, real / total) : 1
  const source: ValhallaMatrix['source'] = core.requests > 1 ? 'valhalla-chunked' : 'valhalla'
  const base = {
    size: n,
    source,
    coverage,
    degraded: core.remaining > 0 || core.failed,
    indexOf: (id: string) => idxMap.get(id) ?? -1,
  }

  if (n <= DENSE_MAX_POINTS) {
    // Flat arrays in the caller's order: the search reads them millions of times.
    const dist = new Float32Array(n * n)
    const dur = new Float32Array(n * n)
    for (let i = 0; i < n; i++) {
      const u = uOf[i]
      for (let j = 0; j < n; j++) {
        const v = uOf[j]
        if (u === v) continue
        const d = M.rawDist(u, v)
        if (d >= 0) {
          dist[i * n + j] = d
          dur[i * n + j] = M.rawDur(u, v)
        } else {
          dist[i * n + j] = estimateKm(u, v)
          dur[i * n + j] = estimateMin(u, v)
        }
      }
    }
    return {
      ...base,
      distance: (from, to) => dist[from * n + to] || 0,
      duration: (from, to) => dur[from * n + to] || 0,
    }
  }

  const inRange = (i: number) => i >= 0 && i < n
  return {
    ...base,
    distance: (from, to) => {
      if (!inRange(from) || !inRange(to)) return 0
      const u = uOf[from],
        v = uOf[to]
      if (u === v) return 0
      const d = M.rawDist(u, v)
      return d >= 0 ? d : estimateKm(u, v)
    },
    duration: (from, to) => {
      if (!inRange(from) || !inRange(to)) return 0
      const u = uOf[from],
        v = uOf[to]
      if (u === v) return 0
      const t = M.rawDur(u, v)
      return t >= 0 ? t : estimateMin(u, v)
    },
  }
}

function buildHaversineMatrix(points: GeoPoint[]): ValhallaMatrix {
  const idxMap = new Map<string, number>()
  for (let i = 0; i < points.length; i++) idxMap.set(points[i].id, i)

  return {
    source: 'haversine',
    size: points.length,
    coverage: 0,
    indexOf: (id: string) => idxMap.get(id) ?? -1,
    distance: (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= points.length || to >= points.length)
        return 0
      return cachedDist(points[from].lat, points[from].lng, points[to].lat, points[to].lng)
    },
    duration: (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= points.length || to >= points.length)
        return 0
      const d = cachedDist(points[from].lat, points[from].lng, points[to].lat, points[to].lng)
      const baseMin = (d / 50) * 60
      return baseMin * trafficFactor(420)
    },
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

interface Built {
  core: Core
  cacheHit: boolean
}

/** Identical builds running at the same time (same organisation, same points) share one engine run. */
const inflight = new Map<string, Promise<Built>>()
let _backgroundRunning = 0

/** Test hook: closes the breaker and forgets every in-process matrix and limiter state. */
export function _resetValhallaBreaker(): void {
  _breakerOpenUntil = 0
  limiter.limit = 0
  l1.clear()
  inflight.clear()
  _lastStats = null
}

async function buildCore(
  coords: Map<string, { lat: number; lng: number; hub: boolean }>,
  dims: VehicleDimensions,
  store: string,
  budgetMs: number,
): Promise<Built> {
  const L = buildLayout(coords, getBlockSize())
  const M = new BlockMatrix(L)
  const core: Core = {
    L,
    M,
    dims,
    store,
    dead: new Uint8Array(L.n),
    accepted: new Uint8Array(L.n),
    refused: new Uint8Array(L.n),
    requests: 0,
    fetchedCells: 0,
    reusedCells: 0,
    failed: false,
    remaining: 0,
    blockSide: getBlockSize(),
    avgRequestMs: 0,
  }
  const previous = await loadSnapshots(store)
  for (const snap of previous) core.reusedCells += M.seedFrom(snap.matrix)

  await runEngine(core, Date.now() + budgetMs, false)

  const cacheHit = core.requests === 0 && !core.failed && M.known > 0
  if (core.fetchedCells > 0) await saveSnapshot(store, M, previous)
  else if (cacheHit) void touchSnapshots(store, previous)
  return { core, cacheHit }
}

/**
 * Finishes, after the caller got its answer, a matrix that ran out of budget — on a private copy,
 * so the matrix a search is reading never changes under it. One at a time per process.
 */
function completeInBackground(core: Core): void {
  const budget = getBackgroundMs()
  if (budget <= 0 || core.failed || core.remaining === 0 || _backgroundRunning > 0) return
  _backgroundRunning++
  const copy: Core = {
    ...core,
    M: core.M.fork(),
    dead: Uint8Array.from(core.dead),
    accepted: Uint8Array.from(core.accepted),
    refused: Uint8Array.from(core.refused),
    requests: 0,
    fetchedCells: 0,
    remaining: 0,
    failed: false,
  }
  const started = Date.now()
  void (async () => {
    try {
      await runEngine(copy, started + budget, true)
      if (copy.fetchedCells > 0) await saveSnapshot(copy.store, copy.M, l1Get(copy.store))
      log.info('Valhalla matrix completed in the background', {
        points: copy.L.n,
        requests: copy.requests,
        cells: copy.fetchedCells,
        complete: copy.remaining === 0 && !copy.failed,
        ms: Date.now() - started,
      })
    } catch (err) {
      log.warn('Valhalla background completion stopped', {
        err: err instanceof Error ? err.message : String(err),
      })
    } finally {
      _backgroundRunning--
    }
  })()
}

export async function buildValhallaMatrix(
  points: GeoPoint[],
  dims?: VehicleDimensions,
  options?: ValhallaMatrixOptions,
): Promise<ValhallaMatrix> {
  if (!getValhallaUrl() || points.length < 2 || breakerOpen()) {
    return buildHaversineMatrix(points)
  }

  const dimensions = dims ?? DEFAULT_DIMENSIONS
  const startedAt = Date.now()

  try {
    const hubs = new Set(options?.hubIds ?? [])
    const coords = new Map<string, { lat: number; lng: number; hub: boolean }>()
    for (const p of points) {
      const key = coordKey(p.lat, p.lng)
      const c = coords.get(key)
      if (c) {
        if (hubs.has(p.id)) c.hub = true
      } else coords.set(key, { lat: p.lat, lng: p.lng, hub: hubs.has(p.id) })
    }
    if (coords.size < 2) return buildHaversineMatrix(points)

    const store = storeKey(options?.scope, dimensions)
    const hubKeys = [...coords]
      .filter(([, c]) => c.hub)
      .map(([k]) => k)
      .sort()
      .join('|')
    const flightKey = `${store}|${matrixCacheKey(points, dimensions)}|${createHash('sha256').update(hubKeys).digest('hex').slice(0, 16)}`

    let flight = inflight.get(flightKey)
    if (!flight) {
      const started = buildCore(coords, dimensions, store, options?.budgetMs ?? getBudgetMs())
      flight = started
      inflight.set(flightKey, started)
      void started
        .catch(() => {})
        .finally(() => {
          if (inflight.get(flightKey) === started) inflight.delete(flightKey)
        })
    }
    const { core, cacheHit } = await flight

    let unreachable = 0
    for (const d of core.dead) unreachable += d
    const stats: ValhallaBuildStats = {
      points: points.length,
      uniquePoints: core.L.n,
      blocks: core.L.K,
      requests: core.requests,
      fetchedCells: core.fetchedCells,
      reusedCells: core.reusedCells,
      totalCells: core.L.n * (core.L.n - 1),
      coverage: 0,
      degraded: core.remaining > 0 || core.failed,
      unreachablePoints: unreachable,
      cacheHit,
      ms: Date.now() - startedAt,
    }

    // Valhalla failed before answering anything and nothing was known: plain straight-line matrix.
    if (core.M.known === 0) {
      _lastStats = stats
      return buildHaversineMatrix(points)
    }

    const matrix = toMatrix(points, core)
    stats.coverage = matrix.coverage ?? 0
    _lastStats = stats
    log.info(cacheHit ? 'Valhalla matrix loaded from cache' : 'Valhalla matrix built', { ...stats })

    completeInBackground(core)
    return matrix
  } catch (err) {
    tripBreaker(err instanceof Error ? err.message : String(err))
    return buildHaversineMatrix(points)
  }
}
