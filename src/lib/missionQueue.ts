import type { Mission } from '@/lib/types'
import { createLogger } from '@/lib/logger'

const log = createLogger('missionQueue')

export interface QueuedMission extends Omit<Mission, 'id'> {
  receivedAt: string
  tenantId:   string
}

let _queue: QueuedMission[] = []

let _dedupKeys = new Set<string>()

const DEDUP_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let _lastDedupCleanup = 0

const MAX_QUEUE_SIZE = 10_000

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const PURGE_INTERVAL_MS = 60_000
let _lastPurge = 0

function dedupKey(m: Omit<Mission, 'id'>, tenantId: string): string {
  return `${m.address}|${m.date}|${tenantId}`
}

function purgeExpired(): void {
  const now = Date.now()
  if (now - _lastPurge < PURGE_INTERVAL_MS) return
  _lastPurge = now

  const cutoff = now - MAX_AGE_MS
  const kept: QueuedMission[] = []
  const keptKeys = new Set<string>()

  for (const m of _queue) {
    const receivedAt = new Date(m.receivedAt).getTime()
    if (!isNaN(receivedAt) && receivedAt >= cutoff) {
      kept.push(m)
      keptKeys.add(dedupKey(m, m.tenantId))
    }
  }

  _queue = kept

  if (now - _lastDedupCleanup > DEDUP_CLEANUP_INTERVAL_MS) {
    _lastDedupCleanup = now
    _dedupKeys = keptKeys
  }
}

export function enqueueMission(m: Omit<Mission, 'id'>, tenantId: string): void {
  purgeExpired()

  if (_queue.length >= MAX_QUEUE_SIZE) {
    log.warn('File pleine — mission ignorée', { address: m.address, maxSize: MAX_QUEUE_SIZE })
    return
  }

  const key = dedupKey(m, tenantId)
  if (_dedupKeys.has(key)) {
    log.debug('Mission doublon ignorée', { address: m.address, date: m.date, tenantId })
    return
  }

  _dedupKeys.add(key)
  _queue.push({
    ...m,
    tenantId,
    receivedAt: new Date().toISOString(),
  })
}

export function drainByDate(date: string, tenantId?: string): QueuedMission[] {
  const matching: QueuedMission[] = []
  const remaining: QueuedMission[] = []

  for (const m of _queue) {
    if (m.date === date && (tenantId === null || tenantId === undefined || m.tenantId === tenantId)) {
      matching.push(m)

      _dedupKeys.delete(dedupKey(m, m.tenantId))
    } else {
      remaining.push(m)
    }
  }

  _queue = remaining
  return matching
}

export function peekQueue(tenantId?: string): QueuedMission[] {
  purgeExpired()
  if (tenantId === null || tenantId === undefined) return [..._queue]
  return _queue.filter(m => m.tenantId === tenantId)
}

export function queueSize(): number {
  return _queue.length
}

export function clearQueue(): void {
  _queue = []
  _dedupKeys = new Set<string>()
}
