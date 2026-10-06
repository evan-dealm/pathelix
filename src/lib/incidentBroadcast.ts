import { getRedisClient, REDIS_AVAILABLE } from './redisClient'
import { createLogger } from './logger'

const log = createLogger('incidentBroadcast')

export interface IncidentEvent {
  missionId:   string
  incidentType: string
  notes:       string
  address:     string
  clientName:  string
  reportedBy:  string
  reportedAt:  string
}

type SSEController = ReadableStreamDefaultController<Uint8Array>

/**
 * Live incident alerts to the dispatchers' SSE streams. With several instances the driver's
 * report and the dispatcher's stream are usually on different ones: the event goes through a
 * Redis channel that every instance listens to (one subscriber connection per process) and each
 * instance writes to its own streams. Without Redis (single instance) it is delivered locally.
 */
const CHANNEL_PREFIX = 'incidents:'
const _g = globalThis as typeof globalThis & {
  __pathelixIncidentChannels?: Map<string, Set<SSEController>>
  __pathelixIncidentSub?: Promise<boolean>
}
const channels = (_g.__pathelixIncidentChannels ??= new Map())

function deliverLocally(tenantId: string, payload: string): void {
  const ctrls = channels.get(tenantId)
  if (!ctrls || ctrls.size === 0) return
  const bytes = new TextEncoder().encode(`data: ${payload}\n\n`)
  for (const ctrl of ctrls) {
    try { ctrl.enqueue(bytes) } catch { ctrls.delete(ctrl) }
  }
}

/** One pattern subscription per process; resolves false when Redis cannot be used. */
function ensureSubscriber(): Promise<boolean> {
  if (!REDIS_AVAILABLE) return Promise.resolve(false)
  _g.__pathelixIncidentSub ??= (async () => {
    try {
      const [{ default: Redis }, { redisBaseOptions }] = await Promise.all([import('ioredis'), import('./queue/connection')])
      const sub = new Redis({ ...redisBaseOptions(), lazyConnect: true, maxRetriesPerRequest: 1 })
      sub.on('error', err => log.warn('Incident subscriber error', { err: String(err) }))
      sub.on('pmessage', (_pattern: string, channel: string, message: string) => deliverLocally(channel.slice(CHANNEL_PREFIX.length), message))
      await sub.connect()
      await sub.psubscribe(`${CHANNEL_PREFIX}*`)
      return true
    } catch (err) {
      log.warn('Incident subscriber unavailable — local delivery only', { err: err instanceof Error ? err.message : String(err) })
      _g.__pathelixIncidentSub = undefined
      return false
    }
  })()
  return _g.__pathelixIncidentSub
}

export function registerIncidentSSE(tenantId: string, ctrl: SSEController): () => void {
  if (!channels.has(tenantId)) channels.set(tenantId, new Set())
  channels.get(tenantId)!.add(ctrl)
  void ensureSubscriber()
  return () => { channels.get(tenantId)?.delete(ctrl) }
}

export async function broadcastIncident(tenantId: string, event: IncidentEvent): Promise<void> {
  const payload = JSON.stringify(event)
  if (REDIS_AVAILABLE && await ensureSubscriber()) {
    try {
      const client = await getRedisClient()
      if (client) { await client.publish(`${CHANNEL_PREFIX}${tenantId}`, payload); return }
    } catch (err) {
      log.warn('Incident publish failed — local delivery only', { err: err instanceof Error ? err.message : String(err) })
    }
  }
  deliverLocally(tenantId, payload)
}
