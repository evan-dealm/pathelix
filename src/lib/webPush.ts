import webpush from 'web-push'
import { createLogger } from '@/lib/logger'
import { isAllowedPushEndpoint } from '@/lib/pushEndpoints'

const PUSH_TIMEOUT_MS = 10_000
const BROADCAST_CONCURRENCY = 20

const log = createLogger('webPush')

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_EMAIL       = process.env.VAPID_EMAIL       || 'admin@pathelix.com'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

export { VAPID_PUBLIC_KEY }

export interface PushPayload {
  title:   string
  body:    string
  icon?:   string
  tag?:    string
  data?:   Record<string, unknown>
}

export interface PushSubRecord {
  endpoint: string
  p256dh:   string
  auth:     string
}

export interface PushSendResult {
  ok:      boolean
  // True only when the push service confirmed the subscription is gone (410/404) — safe to
  // delete. Any other failure (5xx, timeout, throttling, malformed payload...) is transient and
  // must NOT be treated as "expired", or a temporary outage silently deletes valid subscriptions.
  expired: boolean
}

export async function sendPushNotification(
  sub:     PushSubRecord,
  payload: PushPayload,
): Promise<PushSendResult> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    log.warn('VAPID keys not configured — skipping push')
    return { ok: false, expired: false }
  }

  // Rows saved before the endpoint allowlist existed are never contacted (SSRF) — and are
  // reported as expired so callers clean them up.
  if (!isAllowedPushEndpoint(sub.endpoint)) return { ok: false, expired: true }

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { urgency: 'normal', timeout: PUSH_TIMEOUT_MS },
    )
    return { ok: true, expired: false }
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 410 || status === 404) {
      return { ok: false, expired: true }
    }
    log.error('Push failed', { endpoint: sub.endpoint.slice(0, 40), err: String(err) })
    return { ok: false, expired: false }
  }
}

export async function broadcastToTenant(
  subs:    PushSubRecord[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; expired: string[] }> {
  // Bounded concurrency: a large tenant must not open hundreds of simultaneous requests.
  const results: PushSendResult[] = []
  for (let i = 0; i < subs.length; i += BROADCAST_CONCURRENCY) {
    results.push(...await Promise.all(subs.slice(i, i + BROADCAST_CONCURRENCY).map(s => sendPushNotification(s, payload))))
  }
  let sent = 0, failed = 0
  const expired: string[] = []

  results.forEach((r, i) => {
    if (r.ok) { sent++ }
    else {
      failed++
      if (r.expired) expired.push(subs[i].endpoint)
    }
  })

  return { sent, failed, expired }
}
