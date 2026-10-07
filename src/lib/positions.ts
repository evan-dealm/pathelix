import type { TenantDb } from '@/lib/tenantDb'

/**
 * Live positions and speed history, read from the DriverPosition table every GPS source writes
 * to (driver app, Geotab, Samsara, OBD). They used to be served from a per-process memory store:
 * a position received by one instance was invisible to the map served by another, and the VRP
 * worker (another process) never saw any speed at all.
 */

export interface LivePosition { driverId: string; lat: number; lng: number; speedKmh: number; ignition: boolean; updatedAt: number }
export interface SpeedPoint { minuteOfDay: number; speedKmh: number }

const DAY_MS = 86_400_000
/** No time zone is further than 14 h from UTC: a local day always sits inside this margin. */
const TZ_MARGIN_MS = 14 * 3600_000
/** Upper bound of readings scanned for one day of history (≈ 150 trucks every 30 s over 7 h). */
const MAX_HISTORY_ROWS = 100_000

/** Local calendar date and minutes after local midnight of an instant, in `timeZone`. */
function localClock(timeZone: string): (_instant: Date) => { date: string; minute: number } {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  } catch {
    // Unknown zone in the tenant settings: fall back rather than fail the whole map.
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  }
  return (d: Date) => {
    const p: Record<string, string> = {}
    for (const part of fmt.formatToParts(d)) p[part.type] = part.value
    return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) }
  }
}

/** Latest position of each driver since `since` (one row per driver). */
export async function latestPositions(db: TenantDb, opts: { since: Date; driverIds?: string[] }): Promise<LivePosition[]> {
  const rows = await db.driverPosition.findMany({
    where: { recordedAt: { gte: opts.since }, ...(opts.driverIds ? { driverId: { in: opts.driverIds } } : {}) },
    orderBy: { recordedAt: 'desc' },
    distinct: ['driverId'],
    select: { driverId: true, latitude: true, longitude: true, speedKmh: true, recordedAt: true },
  })
  return rows.map(r => ({
    driverId: r.driverId, lat: r.latitude, lng: r.longitude, speedKmh: r.speedKmh ?? 0,
    // The sources do not all report ignition: a moving truck has its engine on.
    ignition: (r.speedKmh ?? 0) > 0, updatedAt: r.recordedAt.getTime(),
  }))
}

/**
 * Speed per minute of the local day `date` (YYYY-MM-DD in `timeZone`), last reading of each
 * minute, per driver. Minutes are local to the tenant, which is what the dispatcher's 05h–22h
 * graph plots — not the server's clock.
 */
export async function speedHistory(db: TenantDb, date: string, timeZone: string, driverIds?: string[]): Promise<Record<string, SpeedPoint[]>> {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(utcMidnight)) return {}
  const rows = await db.driverPosition.findMany({
    where: {
      recordedAt: { gte: new Date(utcMidnight - TZ_MARGIN_MS), lt: new Date(utcMidnight + DAY_MS + TZ_MARGIN_MS) },
      speedKmh: { not: null },
      ...(driverIds ? { driverId: { in: driverIds } } : {}),
    },
    orderBy: { recordedAt: 'asc' },
    select: { driverId: true, speedKmh: true, recordedAt: true },
    take: MAX_HISTORY_ROWS,
  })
  const clock = localClock(timeZone)
  const byDriver = new Map<string, Map<number, number>>()
  for (const r of rows) {
    const local = clock(r.recordedAt)
    if (local.date !== date) continue
    let minutes = byDriver.get(r.driverId)
    if (!minutes) { minutes = new Map(); byDriver.set(r.driverId, minutes) }
    minutes.set(local.minute, r.speedKmh ?? 0)
  }
  const out: Record<string, SpeedPoint[]> = {}
  for (const [d, m] of byDriver) out[d] = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([minuteOfDay, speedKmh]) => ({ minuteOfDay, speedKmh }))
  return out
}
