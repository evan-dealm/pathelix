import { createLogger } from '@/lib/logger'

const log = createLogger('business-events')

/**
 * Business events published to the outside world (signed webhooks, chat channels). Event names
 * are stable and documented in the API reference; payloads carry ids and amounts, never personal
 * data beyond what the subscriber's own tenant already has.
 */
export const BUSINESS_EVENTS = [
  'mission.created', 'mission.completed', 'mission.failed',
  'container.placed', 'container.removed',
  'weighing.created',
  'quote.sent', 'quote.accepted', 'quote.refused',
  'order.created',
  'invoice.issued', 'invoice.sent', 'payment.received',
  'route.optimized',
  'portal.request',
] as const
export type BusinessEvent = typeof BUSINESS_EVENTS[number]

type Dispatcher = (_tenantId: string, _type: BusinessEvent, _data: Record<string, unknown>) => Promise<void>
const _g = globalThis as typeof globalThis & { __pathelixEventDispatchers?: Dispatcher[] }

/** Registers a delivery channel (the webhook outbox registers itself at startup). */
export function onBusinessEvent(d: Dispatcher): void {
  const list = (_g.__pathelixEventDispatchers ??= [])
  if (!list.includes(d)) list.push(d)
}

/** Publishes an event; never throws — a subscriber outage never fails the business action. */
export async function emitBusinessEvent(tenantId: string, type: BusinessEvent, data: Record<string, unknown>): Promise<void> {
  const list = _g.__pathelixEventDispatchers ?? []
  if (list.length === 0) {
    // Lazy registration of the built-in outbox (route bundles do not run instrumentation code).
    try { (await import('@/lib/webhooks/outbox')).registerOutbox() } catch (err) {
      log.warn('Webhook outbox unavailable', { err: err instanceof Error ? err.message : String(err) })
    }
  }
  await Promise.allSettled((_g.__pathelixEventDispatchers ?? []).map(d => d(tenantId, type, data)))
}
