import { getTenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'

const log = createLogger('driverPositionPersist')

export interface DriverPositionInput {
  driverId:  string
  lat:       number
  lng:       number
  speedKmh?: number
  heading?:  number
  timestamp: number
}

/**
 * Persists GPS readings to the `DriverPosition` table, in addition to the in-memory
 * `obdStore` used for live dashboard reads. Non-fatal on failure — a DB write hiccup must
 * never break the webhook's 200 response to the telemetry provider.
 */
export async function persistDriverPositions(
  tenantId:  string,
  readings:  DriverPositionInput[],
): Promise<void> {
  if (readings.length === 0) return
  try {
    const db = getTenantDb(tenantId)
    await db.driverPosition.createMany({
      data: readings.map(r => ({
        driverId:   r.driverId,
        latitude:   r.lat,
        longitude:  r.lng,
        speedKmh:   r.speedKmh ?? null,
        heading:    r.heading ?? null,
        recordedAt: new Date(r.timestamp),
      })) as Parameters<typeof db.driverPosition.createMany>[0]['data'],
    })
  } catch (err) {
    log.warn('Failed to persist driver positions (non-fatal, in-memory store still updated)', {
      tenantId, count: readings.length, err: err instanceof Error ? err.message : String(err),
    })
  }
}
