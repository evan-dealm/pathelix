import { getRedisClient, REDIS_AVAILABLE } from './redisClient'
import { createLogger } from './logger'

const log = createLogger('driverStatusPubSub')

export interface DriverStatusEvent {
  tenantId:   string
  driverId:   string
  missionId:  string
  date:       string
  status:     string
  timestamp:  string
  latitude?:  number
  longitude?: number
}

export function channelName(tenantId: string, date: string): string {
  return `driver-status:${tenantId}:${date}`
}

/**
 * Notifies live dispatch views (SSE, any instance) that a driver's progress changed. The
 * message is only a signal — subscribers re-read the snapshot from the database
 * (src/lib/driverStatusSnapshot.ts), so nothing is lost if Redis drops a message or is down
 * (the SSE route then falls back to polling the database).
 */
export async function publishStatusUpdate(event: DriverStatusEvent): Promise<void> {
  if (!REDIS_AVAILABLE) return
  try {
    const client = await getRedisClient()
    if (!client) return
    await client.publish(channelName(event.tenantId, event.date), JSON.stringify({
      driverId: event.driverId, missionId: event.missionId, status: event.status,
    }))
  } catch (err) {
    log.warn('Status publish failed (live views fall back to polling)', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
