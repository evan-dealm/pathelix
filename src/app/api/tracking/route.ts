import { NextRequest, NextResponse } from 'next/server'
import { z }                         from 'zod'
import { createLogger }              from '@/lib/logger'
import { getRequestContext }         from '@/lib/data/context'
import { signSession }               from '@/lib/session'
import { unscopedPrisma, getTenantDb } from '@/lib/tenantDb'

const log = createLogger('/api/tracking')

const TrackingCreateSchema = z.object({
  missionId: z.string().min(1).max(100),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = TrackingCreateSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { missionId } = parsed.data

  const db = getTenantDb(tenantId)
  const mission = await db.mission.findFirst({
    where: { id: missionId },
    select: { id: true, trackingToken: true },
  })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (mission.trackingToken) {
    return NextResponse.json({ token: mission.trackingToken })
  }

  const token = await signSession({
    sub:      `track:${missionId}`,
    role:     'driver',
    tenantId,
    exp:      Math.floor(Date.now() / 1000) + 7 * 86400,
  })

  await db.mission.update({
    where: { id: missionId },
    data:  { trackingToken: token },
  })

  log.info('Tracking token created', { tenantId, missionId })
  return NextResponse.json({ token })
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const STALE_POSITION_MS = 30 * 60 * 1000

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token requis' }, { status: 400 })

  try {
    // Public tracking link — tenant not yet known here, this lookup is what determines it.
    const mission = await unscopedPrisma.mission.findFirst({
      where:  { trackingToken: token },
      select: {
        id: true, type: true, address: true, clientName: true,
        estimatedDurationMin: true, completedAt: true, cancelledAt: true,
        driverComment: true, actualDurationMin: true,
        tenantId: true, latitude: true, longitude: true,
      },
    })

    if (!mission) return NextResponse.json({ error: 'Token invalide ou expiré' }, { status: 404 })

    const status = mission.completedAt ? 'completed' : mission.cancelledAt ? 'cancelled' : 'in_progress'

    let eta: { minutes: number; distanceKm: number; driverLat: number; driverLng: number; updatedAt: Date } | null = null

    if (status === 'in_progress') {
      const today = new Date().toISOString().split('T')[0]
      const trackDb = getTenantDb(mission.tenantId)
      const plans = await trackDb.plan.findMany({
        where:  { date: today },
        select: { driverId: true, missions: true },
      })

      for (const plan of plans) {
        const planMissions = plan.missions as Array<{ id: string }>
        if (!Array.isArray(planMissions) || !planMissions.some(m => m.id === mission.id)) continue

        const pos = await trackDb.driverPosition.findFirst({
          where:   { driverId: plan.driverId, recordedAt: { gte: new Date(Date.now() - STALE_POSITION_MS) } },
          orderBy: { recordedAt: 'desc' },
          select:  { latitude: true, longitude: true, recordedAt: true },
        })

        if (pos) {
          const distKm = haversineKm(pos.latitude, pos.longitude, mission.latitude, mission.longitude)
          eta = {
            minutes:    Math.max(1, Math.round((distKm / 50) * 60)),
            distanceKm: Math.round(distKm * 10) / 10,
            driverLat:  pos.latitude,
            driverLng:  pos.longitude,
            updatedAt:  pos.recordedAt,
          }
        }
        break
      }
    }

    return NextResponse.json({
      mission: {
        id:            mission.id,
        type:          mission.type,
        address:       mission.address,
        clientName:    mission.clientName,
        status,
        completedAt:   mission.completedAt,
        driverComment: mission.driverComment,
      },
      eta,
    })
  } catch (err) {
    log.error('Tracking GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
