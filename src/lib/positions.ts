import { unscopedPrisma } from '@/lib/tenantDb'

/**
 * Live positions and speed history, read from the DriverPosition table every GPS source writes
 * to (driver app, Geotab, Samsara, OBD). They used to be served from a per-process memory store:
 * a position received by one instance was invisible to the map served by another, and the VRP
 * worker (another process) never saw any speed at all.
 *
 * Both reads are raw SQL on purpose. A fleet of 150 trucks reporting every 30 s writes 180 000
 * rows a day, and the map asks every 15 s: through the ORM, "latest row per driver" pulled every
 * row of the last 12 hours into Node (≈ 240 ms) and the history shipped a whole day of readings
 * to be grouped in JavaScript (≈ 490 ms, silently cut at 100 000 rows — the afternoon was
 * missing). Here the first is one index probe per driver and the second is grouped by the
 * database. Raw SQL bypasses the tenant extension: `tenantId` is an explicit, parametrised
 * condition of every query below — keep it that way.
 */

export interface LivePosition {
  driverId: string
  lat: number
  lng: number
  speedKmh: number
  ignition: boolean
  updatedAt: number
}
export interface SpeedPoint {
  minuteOfDay: number
  speedKmh: number
}

const FALLBACK_TIME_ZONE = 'Europe/Paris'

/**
 * Both reads are polled by every open dispatch screen (map: 15 s, telematics tab: 30 s) and give
 * the same answer to all the screens of an organisation. The answer is kept a few seconds and a
 * read already in progress is shared: N screens cost one query per period, not N. Measured on a
 * 500-driver organisation: the speed history of a day aggregates 540 000 readings (≈ 1.5 s).
 */
const LATEST_TTL_MS = 3_000
const HISTORY_TTL_MS = 20_000
const CACHE_MAX_ENTRIES = 300

interface CacheEntry {
  at: number
  value: Promise<unknown>
}
const _cache: Map<string, CacheEntry> = ((
  globalThis as unknown as { __pathelixPositionsCache?: Map<string, CacheEntry> }
).__pathelixPositionsCache ??= new Map())

function shared<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = _cache.get(key)
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>
  const value = load()
  _cache.set(key, { at: now, value })
  // A failed read is not kept: the next caller tries again.
  value.catch(() => {
    if (_cache.get(key)?.value === value) _cache.delete(key)
  })
  if (_cache.size > CACHE_MAX_ENTRIES) {
    for (const [k, e] of _cache) if (now - e.at > HISTORY_TTL_MS) _cache.delete(k)
    while (_cache.size > CACHE_MAX_ENTRIES) _cache.delete(_cache.keys().next().value as string)
  }
  return value
}

/** Test hook. */
export function _clearPositionsCache(): void {
  _cache.clear()
}

/** A zone PostgreSQL will accept; an unknown one in the tenant settings must not fail the map. */
function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone })
    return timeZone
  } catch {
    return FALLBACK_TIME_ZONE
  }
}

/** Latest position of each driver of the tenant since `since` (one row per driver). */
export function latestPositions(
  tenantId: string,
  opts: { since: Date; driverIds?: string[] },
): Promise<LivePosition[]> {
  // "since" is "now minus 12 h" for every caller: rounded to the minute so that they share a key.
  const sinceKey = Math.floor(opts.since.getTime() / 60_000)
  const idsKey = opts.driverIds ? [...opts.driverIds].sort().join(',') : '*'
  return shared(`latest|${tenantId}|${sinceKey}|${idsKey}`, LATEST_TTL_MS, () =>
    queryLatestPositions(tenantId, opts),
  )
}

async function queryLatestPositions(
  tenantId: string,
  opts: { since: Date; driverIds?: string[] },
): Promise<LivePosition[]> {
  const all = !opts.driverIds
  const ids = opts.driverIds ?? []
  const rows = await unscopedPrisma.$queryRaw<
    Array<{
      driverId: string
      latitude: number
      longitude: number
      speedKmh: number | null
      recordedAt: Date
    }>
  >`
    SELECT d.id AS "driverId", p.latitude, p.longitude, p."speedKmh", p."recordedAt"
    FROM "Driver" d
    CROSS JOIN LATERAL (
      SELECT latitude, longitude, "speedKmh", "recordedAt"
      FROM "DriverPosition"
      WHERE "tenantId" = ${tenantId} AND "driverId" = d.id
        AND "recordedAt" >= (${opts.since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      ORDER BY "recordedAt" DESC
      LIMIT 1
    ) p
    WHERE d."tenantId" = ${tenantId}
      AND (${all}::boolean OR d.id = ANY(${ids}::text[]))`
  return rows.map(r => ({
    driverId: r.driverId,
    lat: r.latitude,
    lng: r.longitude,
    speedKmh: r.speedKmh ?? 0,
    // The sources do not all report ignition: a moving truck has its engine on.
    ignition: (r.speedKmh ?? 0) > 0,
    updatedAt: r.recordedAt.getTime(),
  }))
}

/**
 * Speed per minute of the local day `date` (YYYY-MM-DD in `timeZone`), last reading of each
 * minute, per driver. Minutes are local to the tenant, which is what the dispatcher's 05h–22h
 * graph plots — not the server's clock.
 */
export function speedHistory(
  tenantId: string,
  date: string,
  timeZone: string,
  driverIds?: string[],
): Promise<Record<string, SpeedPoint[]>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return Promise.resolve({})
  }
  const zone = safeTimeZone(timeZone)
  const idsKey = driverIds ? [...driverIds].sort().join(',') : '*'
  return shared(`history|${tenantId}|${date}|${zone}|${idsKey}`, HISTORY_TTL_MS, () =>
    querySpeedHistory(tenantId, date, zone, driverIds),
  )
}

async function querySpeedHistory(
  tenantId: string,
  date: string,
  zone: string,
  driverIds?: string[],
): Promise<Record<string, SpeedPoint[]>> {
  const all = !driverIds
  const ids = driverIds ?? []
  // The index is scanned over exactly the local day (its two ends converted to UTC by
  // PostgreSQL, daylight saving included) — it used to read a 52-hour window to be safe, twice
  // the rows. The local-day filter below stays as the definition of "that day".
  const rows = await unscopedPrisma.$queryRaw<
    Array<{ driverId: string; minute: number; speedKmh: number }>
  >`
    SELECT "driverId", minute, (array_agg("speedKmh" ORDER BY "recordedAt" DESC))[1] AS "speedKmh"
    FROM (
      SELECT "driverId", "speedKmh", "recordedAt",
             ("recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${zone} AS local_ts
      FROM "DriverPosition"
      WHERE "tenantId" = ${tenantId}
        AND "recordedAt" >= ((${date}::date)::timestamp AT TIME ZONE ${zone}) AT TIME ZONE 'UTC'
        AND "recordedAt" <  ((${date}::date + 1)::timestamp AT TIME ZONE ${zone}) AT TIME ZONE 'UTC'
        AND "speedKmh" IS NOT NULL
        AND (${all}::boolean OR "driverId" = ANY(${ids}::text[]))
    ) p
    CROSS JOIN LATERAL (SELECT EXTRACT(HOUR FROM local_ts)::int * 60 + EXTRACT(MINUTE FROM local_ts)::int AS minute) m
    WHERE local_ts >= ${date}::date AND local_ts < (${date}::date + 1)
    GROUP BY "driverId", minute
    ORDER BY "driverId", minute`
  const out: Record<string, SpeedPoint[]> = {}
  for (const r of rows)
    (out[r.driverId] ??= []).push({ minuteOfDay: Number(r.minute), speedKmh: Number(r.speedKmh) })
  return out
}
