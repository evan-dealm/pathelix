import { NextRequest, NextResponse } from 'next/server'
import { z }                         from 'zod'
import { getRequestContext }         from '@/lib/data/context'
import { createLogger }              from '@/lib/logger'
import { broadcastIncident }         from '@/lib/incidentBroadcast'
import { getTenantDb }                from '@/lib/tenantDb'
import { driverOwnsMission, isStaff } from '@/lib/driverAccess'

const log = createLogger('/api/incidents')

const INCIDENT_TYPES = ['accident', 'panne', 'refus', 'acces', 'autre'] as const

const IncidentSchema = z.object({
  missionId:    z.string().min(1).max(100),
  incidentType: z.enum(INCIDENT_TYPES),
  notes:        z.string().max(500).optional(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId, role, driverRef } = getRequestContext(req)

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = IncidentSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { missionId, incidentType, notes } = parsed.data

  const db = getTenantDb(tenantId)
  const mission = await db.mission.findFirst({ where: { id: missionId }, select: { id: true, address: true, clientName: true } })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (!isStaff(role) && !(await driverOwnsMission(db, driverRef ?? userId, missionId))) {
    return NextResponse.json({ error: 'Mission absente de votre tournée' }, { status: 403 })
  }

  try {
    const updated = await db.mission.updateMany({
      where: { id: missionId },
      data:  { incidentAt: new Date(), incidentType, incidentNotes: notes ?? '' },
    })
    if (updated.count === 0) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

    broadcastIncident(tenantId, {
      missionId,
      incidentType,
      notes:       notes ?? '',
      address:     mission.address,
      clientName:  mission.clientName ?? '',
      reportedBy:  userId,
      reportedAt:  new Date().toISOString(),
    })

    log.info('Incident reported', { tenantId, missionId, incidentType, userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('Incident POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (!isStaff(role)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const params   = req.nextUrl.searchParams
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '50', 10) || 50))

  try {
    const db = getTenantDb(tenantId)
    const [incidents, total] = await Promise.all([
      db.mission.findMany({
        where:  { incidentAt: { not: null } },
        select: {
          id: true, address: true, clientName: true,
          incidentAt: true, incidentType: true, incidentNotes: true,
        },
        orderBy: { incidentAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.mission.count({ where: { incidentAt: { not: null } } }),
    ])
    return NextResponse.json({
      incidents,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    log.error('Incident GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
