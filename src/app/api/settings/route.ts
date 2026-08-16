import { NextRequest, NextResponse } from 'next/server'
import { TenantSettingsSchema }      from '@/lib/schemas'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { redisCache }                from '@/lib/redisCache'
import prisma                        from '@/lib/db'
import { TRADE_IDS }                 from '@/lib/trades'
import { customTradeRowToConfig }    from '@/lib/data/customTrades'
import { hasPermission }             from '@/lib/permissions'

const log = createLogger('/api/settings')

let _routingSourceCache: { value: string; ts: number } | null = null

function detectRoutingSource(): string {
  if (_routingSourceCache && Date.now() - _routingSourceCache.ts < 300_000) return _routingSourceCache.value
  let src = 'Haversine'
  if (process.env.ROUTING_API_TYPE && process.env.ROUTING_API_KEY) {
    src = process.env.ROUTING_API_TYPE === 'trimble' ? 'Trimble' : process.env.ROUTING_API_TYPE === 'here' ? 'HERE' : process.env.ROUTING_API_TYPE
  } else if (process.env.VALHALLA_URL) {
    src = 'Valhalla'
  } else if (process.env.OSRM_URL) {
    src = 'OSRM'
  }
  _routingSourceCache = { value: src, ts: Date.now() }
  return src
}

const HEADERS = { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=240' }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0       = Date.now()
  const tenantId = getTenantId(req)

  try {
    const result = await redisCache.getOrSet(
      'settings',
      tenantId,
      async () => {
        const [settings, tenant] = await Promise.all([
          prisma.tenantSettings.findUnique({ where: { tenantId } }),
          prisma.tenant.findUnique({ where: { id: tenantId }, select: { trade: true, name: true } }),
        ])
        const trade = tenant?.trade ?? null
        const tenantName = tenant?.name ?? null
        const routingSource = detectRoutingSource()

        // Custom (superadmin-created) trades are registered server-side
        // via instrumentation.ts, but that registry lives in this process's memory only — the
        // browser's own JS bundle never sees it. Ship the resolved config down to the client so
        // TradeProvider can use it directly instead of an empty client-side registry.
        const customTradeConfig = trade && !(TRADE_IDS as readonly string[]).includes(trade)
          ? await prisma.customTrade.findUnique({ where: { tradeKey: trade } })
              .then(row => row ? customTradeRowToConfig(row) : null)
              .catch(() => null)
          : null

        if (!settings) {
          return {
            tenantId, trade, tenantName, routingSource, customTradeConfig,

            defaultSpeedKmh: 50, defaultStartTime: '07:00',
            maxWorkDayMin: 600, pauseAfterMin: 270, pauseDurationMin: 45,
            costPerKm: 0.35, fuelCostPerLiter: 1.65, consumptionLPer100: 30,

            primaryColor: '#0055A4', logoUrl: '', companyDisplayName: '',

            timezone: 'Europe/Paris', locale: 'fr-FR',

            notificationsEnabled: true, smsEnabled: false, emailEnabled: true,

            invoicePrefix: 'FAC', vatNumber: '', billingEmail: '', supportEmail: '',

            maxOptimizationsPerDay: 10,

            valhallaFactor: 1.60,
          }
        }
        return { ...settings, trade, tenantName, routingSource, customTradeConfig }
      },
      120_000,
    )

    metrics.histogram(METRIC.API_LATENCY_MS, Date.now() - t0, { route: '/api/settings', method: 'GET' })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/settings', method: 'GET', status: '200' })

    return NextResponse.json(result, { headers: HEADERS })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/settings', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId, role } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_settings'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = TenantSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const settings = await prisma.tenantSettings.upsert({
      where:  { tenantId },
      update: parsed.data,
      create: { tenantId, ...parsed.data },
    })

    void redisCache.invalidate('settings', tenantId)
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/settings', method: 'PUT', status: '200' })
    return NextResponse.json(settings)
  } catch (err) {
    log.error('PUT failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/settings', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
