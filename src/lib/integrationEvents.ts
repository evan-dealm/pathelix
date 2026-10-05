import { createLogger } from '@/lib/logger'
import { getTenantDb } from '@/lib/tenantDb'
import { decryptConfig } from '@/lib/configCrypto'
import { safeFetch } from '@/lib/outboundUrl'

const log = createLogger('integrationEvents')

const WEBHOOK_TIMEOUT_MS = 8_000

/** High-frequency technical events are only delivered to custom webhooks that opt in to them —
 *  never to Slack/Teams channels (one message per GPS ping per driver). */
const CHAT_SILENT_EVENTS = new Set<string>(['driver.position'])

type EnabledIntegration = { type: string; config: Record<string, unknown> }

// emitEvent runs on every GPS ping / status change: the enabled-integration list is cached per
// tenant instead of hitting the database each time. Invalidated when integrations are saved.
const CACHE_TTL_MS = 60_000
const _cache = new Map<string, { at: number; items: EnabledIntegration[] }>()

export function invalidateIntegrationCache(tenantId: string): void {
  _cache.delete(tenantId)
}

async function enabledIntegrations(tenantId: string): Promise<EnabledIntegration[]> {
  const hit = _cache.get(tenantId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items
  const rows = await getTenantDb(tenantId).integration.findMany({
    where: { enabled: true, type: { in: ['slack', 'teams', 'custom_webhook', 'twilio_sms'] } },
    select: { type: true, config: true },
  })
  const items: EnabledIntegration[] = []
  for (const row of rows) {
    try {
      // Configs are stored AES-GCM encrypted (src/lib/configCrypto.ts) — reading them raw meant
      // every webhook URL / token was undefined and no notification was ever sent.
      items.push({ type: row.type, config: decryptConfig(row.config) })
    } catch (err) {
      log.warn('Integration config unreadable — skipped', { tenantId, type: row.type, err: err instanceof Error ? err.message : String(err) })
    }
  }
  if (_cache.size > 1000) _cache.clear()
  _cache.set(tenantId, { at: Date.now(), items })
  return items
}

export type EventType =
  | 'mission.created'
  | 'mission.done'
  | 'tour.optimized'
  | 'tour.published'
  | 'anomaly.detected'
  | 'driver.position'
  | 'driver.en_route'

export interface IntegrationEvent {
  type: EventType
  tenantId: string
  timestamp: string
  data: Record<string, unknown>
}

export async function emitEvent(
  tenantId: string,
  type: EventType,
  data: Record<string, unknown>,
): Promise<void> {
  const event: IntegrationEvent = {
    type,
    tenantId,
    timestamp: new Date().toISOString(),
    data,
  }

  if (!process.env.DATABASE_URL) return

  try {
    const integrations = await enabledIntegrations(tenantId)

    const promises: Promise<void>[] = []

    for (const integration of integrations) {
      const config = integration.config

      switch (integration.type) {
        case 'slack':
          if (!CHAT_SILENT_EVENTS.has(type)) promises.push(sendSlack(config, event))
          break
        case 'teams':
          if (!CHAT_SILENT_EVENTS.has(type)) promises.push(sendTeams(config, event))
          break
        case 'custom_webhook':
          promises.push(sendCustomWebhook(config, event))
          break
        case 'twilio_sms':
          if (type === 'driver.en_route') {
            promises.push(sendTwilioSMS(config, event))
          }
          break
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises)
    }
  } catch (err) {

    log.warn('Event dispatch skipped (non-fatal)', {
      type, tenantId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

async function sendSlack(config: Record<string, unknown>, event: IntegrationEvent): Promise<void> {
  const webhookUrl = String(config.webhookUrl ?? '')
  if (!webhookUrl) return

  const text = formatEventMessage(event)
  const color = event.type.includes('anomaly') ? '#EF4444'
    : event.type.includes('done') ? '#22C55E'
    : '#3B82F6'

  try {
    await safeFetch(webhookUrl, {
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [{
          color,
          title: `PATHÉLIX — ${EVENT_LABELS[event.type] ?? event.type}`,
          text,
          ts: Math.floor(Date.now() / 1000),
        }],
      }),
    })
  } catch (err) {
    log.warn('Slack notification failed', { err: err instanceof Error ? err.message : String(err) })
  }
}

async function sendTeams(config: Record<string, unknown>, event: IntegrationEvent): Promise<void> {
  const webhookUrl = String(config.webhookUrl ?? '')
  if (!webhookUrl) return

  const text = formatEventMessage(event)
  const color = event.type.includes('anomaly') ? 'attention'
    : event.type.includes('done') ? 'good'
    : 'accent'

  try {
    await safeFetch(webhookUrl, {
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: color === 'attention' ? 'EF4444' : color === 'good' ? '22C55E' : '3B82F6',
        summary: `PATHÉLIX — ${EVENT_LABELS[event.type] ?? event.type}`,
        sections: [{
          activityTitle: EVENT_LABELS[event.type] ?? event.type,
          text,
          markdown: true,
        }],
      }),
    })
  } catch (err) {
    log.warn('Teams notification failed', { err: err instanceof Error ? err.message : String(err) })
  }
}

async function sendCustomWebhook(config: Record<string, unknown>, event: IntegrationEvent): Promise<void> {
  const url = String(config.url ?? '')
  if (!url) return

  const configuredEvents = String(config.events ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (configuredEvents.length > 0 && !configuredEvents.includes(event.type)) return
  // GPS pings only when explicitly subscribed to.
  if (configuredEvents.length === 0 && CHAT_SILENT_EVENTS.has(event.type)) return

  const payload = JSON.stringify(event)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Pathelix/1.0',
  }

  const secret = String(config.secret ?? '')
  if (secret) {
    const { createHmac } = await import('crypto')
    const signature = createHmac('sha256', secret).update(payload).digest('hex')
    headers['X-Pathelix-Signature'] = signature
  }

  try {
    await safeFetch(url, { timeoutMs: WEBHOOK_TIMEOUT_MS, method: 'POST', headers, body: payload })
  } catch (err) {
    // No URL in the log: webhook URLs routinely embed a secret token.
    log.warn('Custom webhook failed', { type: event.type, err: err instanceof Error ? err.message : String(err) })
  }
}

async function sendTwilioSMS(config: Record<string, unknown>, event: IntegrationEvent): Promise<void> {
  const sid = String(config.accountSid ?? '')
  const token = String(config.authToken ?? '')
  const from = String(config.fromNumber ?? '')
  if (!sid || !token || !from) return

  const clientPhone = String(event.data.clientPhone ?? '')
  if (!clientPhone) return

  const driverName = String(event.data.driverName ?? 'votre chauffeur')
  const eta = String(event.data.etaMinutes ?? '30')
  const message = `PATHÉLIX : votre benne arrive dans environ ${eta} minutes. Chauffeur : ${driverName}.`

  try {
    const body = new URLSearchParams({ To: clientPhone, From: from, Body: message })
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    // End-customer phone numbers are personal data — only the last digits are logged.
    log.info('SMS sent', { to: `…${clientPhone.slice(-2)}` })
  } catch (err) {
    log.warn('Twilio SMS failed', { err: err instanceof Error ? err.message : String(err) })
  }
}

const EVENT_LABELS: Record<string, string> = {
  'mission.created': 'Nouvelle mission',
  'mission.done': 'Mission terminee',
  'tour.optimized': 'Optimisation terminee',
  'tour.published': 'Plan publie',
  'anomaly.detected': 'Anomalie detectee',
  'driver.position': 'Position chauffeur',
  'driver.en_route': 'Chauffeur en route',
}

function formatEventMessage(event: IntegrationEvent): string {
  const d = event.data
  switch (event.type) {
    case 'mission.done':
      return `Mission terminee par ${d.driverName ?? '?'} — ${d.missionType ?? ''} a ${d.address ?? '?'} (${d.durationMin ?? '?'} min)`
    case 'tour.optimized':
      return `${d.assignedMissions ?? '?'} missions assignees a ${d.driverCount ?? '?'} chauffeurs — score ${d.score ?? '?'}/100 (${d.timeTakenMs ?? '?'}ms)`
    case 'anomaly.detected':
      return `⚠️ ${d.reason ?? 'Anomalie'} — chauffeur ${d.driverName ?? '?'}, mission ${d.missionId ?? '?'}`
    case 'driver.en_route':
      return `${d.driverName ?? '?'} en route vers ${d.clientName ?? '?'} — ETA ~${d.etaMinutes ?? '?'} min`
    default:
      return JSON.stringify(d).slice(0, 200)
  }
}
