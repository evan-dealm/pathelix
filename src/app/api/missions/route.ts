import { NextRequest, NextResponse }     from 'next/server'
import { MissionSchema }                  from '@/lib/schemas'
import { peekQueue }                      from '@/lib/missionQueue'
import { createLogger }                   from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { getAllMissions, getMissionsByDate, createMission } from '@/lib/data/missions'
import { redisCache }                     from '@/lib/redisCache'
import { auditAsync }                     from '@/lib/audit'
import { createTenantRateLimiter }        from '@/lib/rateLimit'
import { metrics, METRIC }               from '@/lib/metrics'
import { hasPermission }                  from '@/lib/permissions'
import prisma                             from '@/lib/db'

const _missionsWriteRl = createTenantRateLimiter(100, 60_000, 'missions-write')

const log = createLogger('/api/missions')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0       = Date.now()
  const tenantId = getTenantId(req)
  const params   = req.nextUrl.searchParams
  const date     = params.get('date') ?? undefined
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('pageSize') ?? params.get('limit') ?? '50', 10) || 50))

  try {

    const cacheQualifier = date ?? 'all'
    const cacheTtl = date ? 60_000 : 15_000
    const missions = await redisCache.getOrSet(
      'missions',
      tenantId,
      () => date ? getMissionsByDate(tenantId, date) : getAllMissions(tenantId),
      cacheTtl,
      cacheQualifier,
    )

    const queued = peekQueue(tenantId)
      .filter(q => !(q.latitude === 0 && q.longitude === 0) &&
                   Number.isFinite(q.latitude) && Number.isFinite(q.longitude) &&
                   Math.abs(q.latitude) <= 90 && Math.abs(q.longitude) <= 180)
      .map(q => ({
        ...q,
        id:     `nessy-preview-${q.date}-${q.type}-${q.address.slice(0, 15).replace(/\W+/g, '-')}-${Math.round(q.latitude * 1000)}_${Math.round(q.longitude * 1000)}`,
        _nessy: true,
      }))

    const all   = [...missions, ...queued]
    const start = (page - 1) * limit
    const paged = all.slice(start, start + limit)

    metrics.histogram(METRIC.API_LATENCY_MS, Date.now() - t0, { route: '/api/missions', method: 'GET' })
    metrics.increment(METRIC.API_REQUESTS,   { route: '/api/missions', method: 'GET', status: '200' })

    const total = all.length
    return NextResponse.json({
      data:       paged,
      total,
      page,
      pageSize:   limit,
      totalPages: Math.ceil(total / limit),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    }, { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=60' } })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/missions', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {

  const action = req.nextUrl.searchParams.get('action')
  if (action === 'archive-all') {
    const { tenantId, role } = getRequestContext(req)
    if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
    try {
      const result = await prisma.mission.updateMany({ where: { tenantId, archived: false }, data: { archived: true } })
      await redisCache.invalidateAll('missions', tenantId)
      return NextResponse.json({ ok: true, archived: result.count })
    } catch (err) {
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }
  }

  const { tenantId: rlTenantId, userId, role } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_missions'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  const rlOk = await _missionsWriteRl.check(rlTenantId)
  if (!rlOk) return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 })

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = MissionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const tenantId = getTenantId(req)

    const [tenant, count] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { maxMissions: true } }),
      prisma.mission.count({ where: { tenantId, archived: false } }),
    ])
    if (tenant?.maxMissions !== null && tenant?.maxMissions !== undefined) {
      if (count >= tenant.maxMissions) {
        return NextResponse.json({ error: `Limite de ${tenant.maxMissions} missions atteinte pour ce plan` }, { status: 403 })
      }
    }

    const mission  = await createMission(tenantId, parsed.data)

    await Promise.all([
      redisCache.invalidate('missions', tenantId, parsed.data.date),
      redisCache.invalidate('missions', tenantId, 'all'),
    ])

    auditAsync(req, 'mission.create', 'Mission', mission.id, { type: parsed.data.type, address: parsed.data.address, date: parsed.data.date })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/missions', method: 'POST', status: '201' })
    return NextResponse.json(mission, { status: 201 })
  } catch (err) {
    // P2003 : clientId / driverId / linkedExutoireId référence un enregistrement inexistant
    // (ex. supprimé entre le chargement du formulaire et la soumission) — erreur client, pas serveur
    if (err instanceof Error && (err as { code?: string }).code === 'P2003') {
      return NextResponse.json({ error: 'Référence invalide : client, chauffeur ou exutoire inexistant' }, { status: 422 })
    }
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/missions', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
