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

const DAY_MS = 86_400_000
/** No time zone is further than 14 h from UTC: a local day always sits inside this margin. */
const TZ_MARGIN_MS = 14 * 3600_000
const FALLBACK_TIME_ZONE = 'Europe/Paris'

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
export async function latestPositions(
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
export async function speedHistory(
  tenantId: string,
  date: string,
  timeZone: string,
  driverIds?: string[],
): Promise<Record<string, SpeedPoint[]>> {
  const utcMidnight = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN
  if (Number.isNaN(utcMidnight)) return {}
  const zone = safeTimeZone(timeZone)
  const all = !driverIds
  const ids = driverIds ?? []
  // The UTC window only narrows the index scan; the local-day filter below is the real one.
  const from = new Date(utcMidnight - TZ_MARGIN_MS).toISOString()
  const to = new Date(utcMidnight + DAY_MS + TZ_MARGIN_MS).toISOString()
  const rows = await unscopedPrisma.$queryRaw<
    Array<{ driverId: string; minute: number; speedKmh: number }>
  >`
    SELECT "driverId", minute, (array_agg("speedKmh" ORDER BY "recordedAt" DESC))[1] AS "speedKmh"
    FROM (
      SELECT "driverId", "speedKmh", "recordedAt",
             ("recordedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${zone} AS local_ts
      FROM "DriverPosition"
      WHERE "tenantId" = ${tenantId}
        AND "recordedAt" >= (${from}::timestamptz AT TIME ZONE 'UTC')
        AND "recordedAt" <  (${to}::timestamptz AT TIME ZONE 'UTC')
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
