import { getTenantDb } from '@/lib/tenantDb'
import { decryptConfig } from '@/lib/configCrypto'
import { createLogger } from '@/lib/logger'

const log = createLogger('vrp/routingProvider')

export interface RoutingProvider { type: 'trimble' | 'here'; apiKey: string }

/**
 * Truck-routing licence brought by the organisation (Intégrations → Trimble Maps / HERE). When
 * set, it is used for that organisation's matrices; otherwise the server-wide ROUTING_API_* setting
 * (if any), then Valhalla, then straight-line estimates.
 */
export async function tenantRoutingProvider(tenantId: string): Promise<RoutingProvider | null> {
  try {
    const rows = await getTenantDb(tenantId).integration.findMany({
      where: { enabled: true, type: { in: ['trimble', 'here'] } },
      select: { type: true, config: true },
    })
    for (const r of rows) {
      const cfg = decryptConfig(r.config)
      const apiKey = String(cfg.apiKey ?? '')
      if (apiKey.length >= 8) return { type: r.type as RoutingProvider['type'], apiKey }
    }
  } catch (err) {
    log.warn('Routing provider unreadable — server default used', { tenantId, err: err instanceof Error ? err.message : String(err) })
  }
  return null
}
