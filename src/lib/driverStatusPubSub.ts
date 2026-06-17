import { getRedisClient, REDIS_AVAILABLE } from './redisClient'
import { createLogger } from './logger'
import { _statusStore as sharedStatusStore } from './statusStore'

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

export async function publishStatusUpdate(event: DriverStatusEvent): Promise<void> {

  storeInMemory(event)

  if (!REDIS_AVAILABLE) return

  try {
    const client = await getRedisClient()
    if (!client) return

    const channel = channelName(event.tenantId, event.date)
    // Publish in the same {[driverId]: {[missionId]: status}} format that the SSE
    // route expects, so all publishers are consistent regardless of update type.
    const sharedKey = `${encodeURIComponent(event.tenantId)}|${encodeURIComponent(event.driverId)}|${event.date}`
    const driverStatuses = sharedStatusStore.get(sharedKey) ?? {}
    const payload = JSON.stringify({ [event.driverId]: driverStatuses })

    client.publish(channel, payload).catch((err: Error) => {
      log.warn('Redis publish failed (non-critical)', { err: err.message })
    })
  } catch (err) {
    log.warn('publishStatusUpdate failed (non-critical)', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

export interface StatusSubscription {

  unsubscribe: () => Promise<void>
}

export async function subscribeStatusUpdates(
  tenantId: string,
  date: string,
  onEvent: (_event: DriverStatusEvent) => void,
): Promise<StatusSubscription | null> {
  if (!REDIS_AVAILABLE) return null

  try {
    const mainClient = await getRedisClient()
    if (!mainClient) return null

    const subClient = mainClient.duplicate()
    const channel = channelName(tenantId, date)

    subClient.on('message', (_ch: string, message: string) => {
      try {
        const event = JSON.parse(message) as DriverStatusEvent
        onEvent(event)
      } catch {
        log.warn('Failed to parse status event', { message: message.slice(0, 100) })
      }
    })

    await subClient.subscribe(channel)
    log.info('Subscribed to status channel', { channel })

    return {
      unsubscribe: async () => {
        try {
          await subClient.unsubscribe(channel)
          subClient.disconnect()
        } catch {

        }
      },
    }
  } catch (err) {
    log.warn('subscribeStatusUpdates failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

interface InMemoryStatus {
  status: string
  timestamp: string
  latitude?: number
  longitude?: number
}

const _statusStore = new Map<string, Map<string, InMemoryStatus>>()

let _pruneCounter = 0
const PRUNE_INTERVAL = 50
const MAX_STORE_KEYS = 5000

function storeInMemory(event: DriverStatusEvent): void {
  const key = `${event.tenantId}:${event.date}:${event.driverId}`
  let missions = _statusStore.get(key)
  if (!missions) {
    missions = new Map()
    _statusStore.set(key, missions)
  }
  missions.set(event.missionId, {
    status:    event.status,
    timestamp: event.timestamp,
    latitude:  event.latitude,
    longitude: event.longitude,
  })

  const sharedKey = `${encodeURIComponent(event.tenantId)}|${encodeURIComponent(event.driverId)}|${event.date}`
  const existing = sharedStatusStore.get(sharedKey) ?? {}
  existing[event.missionId] = event.status
  sharedStatusStore.set(sharedKey, existing)

  if (++_pruneCounter >= PRUNE_INTERVAL || _statusStore.size > MAX_STORE_KEYS) {
    _pruneCounter = 0
    pruneOldEntries()

    if (_statusStore.size > MAX_STORE_KEYS) {
      const iter = _statusStore.keys()
      while (_statusStore.size > MAX_STORE_KEYS * 0.8) {
        const k = iter.next().value
        if (k !== undefined) _statusStore.delete(k)
        else break
      }
    }
  }
}

function pruneOldEntries(): void {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 2)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  for (const key of _statusStore.keys()) {
    const date = key.split(':')[1]
    if (date < cutoffStr) _statusStore.delete(key)
  }
}

export function getInMemoryStatuses(
  tenantId: string,
  date: string,
  driverId?: string,
): Record<string, Record<string, InMemoryStatus>> {
  const result: Record<string, Record<string, InMemoryStatus>> = {}

  for (const [key, missions] of _statusStore) {
    const [kt, kd, kdriver] = key.split(':')
    if (kt !== tenantId || kd !== date) continue
    if (driverId && kdriver !== driverId) continue

    const missionMap: Record<string, InMemoryStatus> = {}
    for (const [mid, status] of missions) {
      missionMap[mid] = status
    }
    result[kdriver] = missionMap
  }

  return result
}
