import webpush from 'web-push'
import { createLogger } from '@/lib/logger'

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

export async function sendPushNotification(
  sub:     PushSubRecord,
  payload: PushPayload,
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    log.warn('VAPID keys not configured — skipping push')
    return false
  }

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { urgency: 'normal' },
    )
    return true
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 410 || status === 404) {

      return false
    }
    log.error('Push failed', { endpoint: sub.endpoint.slice(0, 40), err: String(err) })
    return false
  }
}

export async function broadcastToTenant(
  subs:    PushSubRecord[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number; expired: string[] }> {
  const results = await Promise.allSettled(subs.map(s => sendPushNotification(s, payload)))
  let sent = 0, failed = 0
  const expired: string[] = []

  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) { sent++ }
    else {
      failed++
      if (r.status === 'rejected') expired.push(subs[i].endpoint)
    }
  })

  return { sent, failed, expired }
}
