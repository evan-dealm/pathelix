import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenantDb } from '@/lib/tenantDb'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { encryptConfig } from '@/lib/configCrypto'
import { invalidateIntegrationCache } from '@/lib/integrationEvents'
import { hasPermission } from '@/lib/permissions'
import { auditAsync } from '@/lib/audit'

const log = createLogger('/api/integrations')

const INTEGRATION_TYPES = [

  { type: 'trimble',         name: 'Trimble Maps',         description: 'Calcul de routes poids-lourds (restrictions, péages)', category: 'routing' },
  { type: 'here',            name: 'HERE Truck Routing',   description: 'Routage PL avec trafic temps reel et zones ZFE', category: 'routing' },

  { type: 'geotab',          name: 'Geotab',               description: 'Telematique universelle — positions GPS et donnees moteur via boitier OBD', category: 'telemetry' },
  { type: 'samsara',         name: 'Samsara',              description: 'GPS + cameras embarquees + suivi temperature', category: 'telemetry' },
  { type: 'obd',             name: 'OBD générique',        description: 'Positions GPS/vitesse depuis un boîtier OBD générique, un token webhook par tenant', category: 'telemetry' },

  { type: 'nessy',           name: 'Nessy (Webhook)',      description: 'Réception automatique des missions depuis Nessy via webhook HMAC-SHA256', category: 'erp' },

  { type: 'slack',           name: 'Slack',                description: 'Notifications de tournées et alertes anomalies dans vos canaux', category: 'notifications' },
  { type: 'teams',           name: 'Microsoft Teams',      description: 'Notifications dans Teams via webhook', category: 'notifications' },
  { type: 'twilio_sms',      name: 'SMS (Twilio)',         description: 'Notifier vos clients par SMS : "Votre benne arrive dans 30 min"', category: 'notifications' },

  { type: 'custom_webhook',  name: 'Webhook personnalisé', description: 'Envoyer des événements vers n\'importe quelle URL', category: 'custom' },
] as const

const IntegrationConfigSchema = z.object({
  type:    z.string().min(1),
  config:  z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)

  const configured = await getTenantDb(tenantId).integration.findMany({
    select: { id: true, type: true, name: true, enabled: true, lastSyncAt: true, lastError: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  const configuredTypes = new Set(configured.map(i => i.type))

  const marketplace = INTEGRATION_TYPES.map(t => ({
    ...t,
    configured: configuredTypes.has(t.type),
    integration: configured.find(c => c.type === t.type) ?? null,
  }))

  return NextResponse.json({ integrations: configured, marketplace })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId, role } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_integrations'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = IntegrationConfigSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const typeInfo = INTEGRATION_TYPES.find(t => t.type === parsed.data.type)
  if (!typeInfo) return NextResponse.json({ error: 'Type d\'integration inconnu' }, { status: 400 })

  try {
    const plainConfig = parsed.data.config ?? {}
    const encryptedConfig = encryptConfig(plainConfig)

    const db = getTenantDb(tenantId)
    const integration = await db.integration.upsert({
      // The compound unique key structurally requires tenantId here — this is not a manual
      // tenant-scope check to remove, it's part of the DB constraint's shape.
      where: { tenantId_type: { tenantId, type: parsed.data.type } },
      create: {
        type: parsed.data.type,
        name: typeInfo.name,
        config: (encryptedConfig as unknown) as Parameters<typeof db.integration.create>[0]['data']['config'],
        enabled: parsed.data.enabled ?? true,
      } as Parameters<typeof db.integration.upsert>[0]['create'],
      update: {
        config: parsed.data.config ? ((encryptedConfig as unknown) as Parameters<typeof db.integration.update>[0]['data']['config']) : undefined,
        enabled: parsed.data.enabled,
        lastError: null,
      },
    })

    invalidateIntegrationCache(tenantId)
    log.info('Integration configured', { tenantId, type: parsed.data.type })
    auditAsync(req, 'integration.configure', 'Integration', integration.id, {
      type: parsed.data.type,
      enabled: integration.enabled,
      configChanged: Boolean(parsed.data.config),
    })
    return NextResponse.json(integration, { status: 201 })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
