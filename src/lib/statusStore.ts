import { createLogger } from '@/lib/logger'

const log = createLogger('statusStore')

export const _statusStore = new Map<string, Record<string, string>>()

const STATUS_TTL_SECONDS = 172_800

export async function getStatusFromStore(
  tenantId: string,
  driverId: string,
  date: string,
): Promise<Record<string, string>> {
  try {
    const { getRedisClient } = await import('@/lib/redisClient')
    const redis = await getRedisClient()
    if (redis) {
      const key = `status:${tenantId}:${driverId}:${date}`
      const cached = await redis.get(key)
      if (cached) return JSON.parse(cached) as Record<string, string>
    }
  } catch (err) {
    log.warn('Redis getStatus failed, using in-memory', { err: err instanceof Error ? err.message : String(err) })
  }

  const inMemKey = storeKey(tenantId, driverId, date)
  return _statusStore.get(inMemKey) ?? {}
}

export async function setStatusInStore(
  tenantId: string,
  driverId: string,
  date: string,
  statuses: Record<string, string>,
): Promise<void> {
  const inMemKey = storeKey(tenantId, driverId, date)
  _statusStore.set(inMemKey, statuses)

  try {
    const { getRedisClient } = await import('@/lib/redisClient')
    const redis = await getRedisClient()
    if (redis) {
      const key = `status:${tenantId}:${driverId}:${date}`
      await redis.setex(key, STATUS_TTL_SECONDS, JSON.stringify(statuses))
    }
  } catch (err) {
    log.warn('Redis setStatus failed, data in memory only', { err: err instanceof Error ? err.message : String(err) })
  }
}

export async function getAllStatusesForDate(
  tenantId: string,
  date: string,
): Promise<Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, string>> = {}

  const encodedTenant = encodeURIComponent(tenantId)
  for (const [key, statuses] of _statusStore.entries()) {
    const parts = key.split('|')
    if (parts.length !== 3) continue
    const [kTenant, kDriver, kDate] = parts
    if (kDate === date && kTenant === encodedTenant && kDriver) {
      result[decodeURIComponent(kDriver)] = statuses
    }
  }

  return result
}

function storeKey(tenantId: string, driverId: string, date: string): string {
  return `${encodeURIComponent(tenantId)}|${encodeURIComponent(driverId)}|${date}`
}

export function pruneOldStatusEntries(daysToKeep = 7): void {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysToKeep)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  for (const key of _statusStore.keys()) {
    const parts = key.split('|')
    if (parts.length < 3) continue
    const date = parts[2]
    if (date && date < cutoffStr) _statusStore.delete(key)
  }
}
