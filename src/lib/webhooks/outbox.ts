import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { getTenantDb, unscopedPrisma } from '@/lib/tenantDb'
import { decryptConfig } from '@/lib/configCrypto'
import { safeFetch } from '@/lib/outboundUrl'
import { createLogger } from '@/lib/logger'
import { metrics } from '@/lib/metrics'
import { onBusinessEvent, type BusinessEvent } from '@/lib/events/outbound'
import { bust, onBust } from '@/lib/cacheBus'

const log = createLogger('webhooks')

/**
 * Outbound webhooks (outbox pattern). An event is written as one delivery row per subscribed
 * endpoint, then sent: right away in the request's process, and retried by the webhook worker
 * with exponential backoff (1 min → 24 h) until success or DEAD after 7 attempts. A dead delivery
 * can be replayed from the admin.
 *
 * Every request is signed: `Pathelix-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret,
 * "<t>.<raw body>")>`, with `Pathelix-Event-Id` (stable across retries — consumers deduplicate
 * on it) and `Pathelix-Event-Type`. Consumers should reject a timestamp older than 5 minutes.
 */

export const RETRY_DELAYS_MIN = [1, 5, 30, 120, 360, 1440]
export const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1
const TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/** Reference verification (what a consumer does) — also used by the tests. */
export function verifySignature(secret: string, header: string, body: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec || !parts.v1) return false
  const expected = Buffer.from(signPayload(secret, t, body), 'hex')
  const got = Buffer.from(parts.v1, 'hex')
  return expected.length === got.length && timingSafeEqual(expected, got)
}

const _cache = new Map<string, { at: number; endpoints: Array<{ id: string; events: string[] }> }>()
onBust('webhooks', tenantId => { _cache.delete(tenantId) })
export function invalidateWebhookCache(tenantId: string): void { bust('webhooks', tenantId) }

async function subscribers(tenantId: string, type: string): Promise<string[]> {
  let hit = _cache.get(tenantId)
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) {
    const rows = await getTenantDb(tenantId).webhookEndpoint.findMany({ where: { active: true }, select: { id: true, events: true } })
    hit = { at: Date.now(), endpoints: rows.map(r => ({ id: r.id, events: Array.isArray(r.events) ? r.events.filter((e): e is string => typeof e === 'string') : [] })) }
    if (_cache.size > 2000) _cache.clear()
    _cache.set(tenantId, hit)
  }
  return hit.endpoints.filter(e => e.events.length === 0 || e.events.includes(type)).map(e => e.id)
}

/** Writes the deliveries of an event and tries them right away (never throws). */
export async function enqueueEvent(tenantId: string, type: BusinessEvent, data: Record<string, unknown>): Promise<number> {
  try {
    const endpointIds = await subscribers(tenantId, type)
    if (endpointIds.length === 0) return 0
    const eventId = `evt_${randomUUID()}`
    const payload = { id: eventId, type, createdAt: new Date().toISOString(), data }
    const db = getTenantDb(tenantId)
    const created = await Promise.all(endpointIds.map(endpointId => db.webhookDelivery.create({
      data: { endpointId, eventId, eventType: type, payload } as Parameters<typeof db.webhookDelivery.create>[0]['data'],
      select: { id: true },
    })))
    for (const d of created) void attemptDelivery(d.id)
    return created.length
  } catch (err) {
    log.warn('Webhook enqueue failed', { tenantId, type, err: err instanceof Error ? err.message : String(err) })
    return 0
  }
}

let _registered = false
export function registerOutbox(): void {
  if (_registered) return
  _registered = true
  onBusinessEvent(async (tenantId, type, data) => { await enqueueEvent(tenantId, type, data) })
}

/**
 * Sends one delivery if it is due. The row is claimed first (its next attempt pushed 2 minutes
 * ahead) so two processes — the request's and the worker's — never send it twice at once.
 * Cross-tenant by id: called from the worker and from tenant-checked routes.
 */
export async function attemptDelivery(deliveryId: string): Promise<'SUCCESS' | 'FAILED' | 'DEAD' | 'SKIPPED'> {
  const now = new Date()
  const claimed = await unscopedPrisma.webhookDelivery.updateMany({
    where: { id: deliveryId, status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: new Date(now.getTime() + 120_000) },
  })
  if (claimed.count === 0) return 'SKIPPED'
  const d = await unscopedPrisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } })
  if (!d) return 'SKIPPED'
  const body = JSON.stringify(d.payload)
  const ts = Math.floor(Date.now() / 1000)
  let statusCode: number | null = null
  let error: string | null = null
  try {
    if (!d.endpoint.active) throw new Error('Point de terminaison désactivé')
    const secret = String(decryptConfig(d.endpoint.secret).secret ?? '')
    if (!secret) throw new Error('Secret de signature illisible')
    const res = await safeFetch(d.endpoint.url, {
      method: 'POST', timeoutMs: TIMEOUT_MS, redirect: 'manual',
      headers: {
        'Content-Type': 'application/json', 'User-Agent': 'Pathelix-Webhooks/1.0',
        'Pathelix-Event-Id': d.eventId, 'Pathelix-Event-Type': d.eventType,
        'Pathelix-Signature': `t=${ts},v1=${signPayload(secret, ts, body)}`,
      },
      body,
    })
    statusCode = res.status
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`
  } catch (err) {
    error = (err instanceof Error ? err.message : String(err)).slice(0, 300)
  }
  const attempts = d.attempts + 1
  if (!error) {
    await unscopedPrisma.$transaction([
      unscopedPrisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'SUCCESS', attempts, lastStatusCode: statusCode, lastError: null, deliveredAt: new Date() } }),
      unscopedPrisma.webhookEndpoint.update({ where: { id: d.endpointId }, data: { lastSuccessAt: new Date(), consecutiveFailures: 0 } }),
    ])
    metrics.increment('webhooks.delivered', { result: 'success' })
    return 'SUCCESS'
  }
  const dead = attempts >= MAX_ATTEMPTS
  const delay = RETRY_DELAYS_MIN[Math.min(attempts - 1, RETRY_DELAYS_MIN.length - 1)]
  await unscopedPrisma.$transaction([
    unscopedPrisma.webhookDelivery.update({
      where: { id: d.id },
      data: { status: dead ? 'DEAD' : 'FAILED', attempts, lastStatusCode: statusCode, lastError: error, nextAttemptAt: new Date(Date.now() + delay * 60_000) },
    }),
    unscopedPrisma.webhookEndpoint.update({ where: { id: d.endpointId }, data: { lastFailureAt: new Date(), consecutiveFailures: { increment: 1 } } }),
  ])
  metrics.increment('webhooks.delivered', { result: dead ? 'dead' : 'failed' })
  // No URL in the log: webhook URLs routinely embed a token.
  log.warn('Webhook delivery failed', { tenantId: d.tenantId, eventType: d.eventType, attempts, dead, statusCode, error })
  return dead ? 'DEAD' : 'FAILED'
}

/** Sends every due delivery (worker tick). Returns how many were attempted. */
export async function processDueDeliveries(limit = 50): Promise<number> {
  const due = await unscopedPrisma.webhookDelivery.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date() } },
    select: { id: true }, orderBy: { nextAttemptAt: 'asc' }, take: limit,
  })
  for (const d of due) await attemptDelivery(d.id)
  return due.length
}
