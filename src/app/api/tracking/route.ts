import { NextRequest, NextResponse } from 'next/server'
import { randomBytes }               from 'node:crypto'
import { z }                         from 'zod'
import { createLogger }              from '@/lib/logger'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { isStaff }                   from '@/lib/driverAccess'
import { unscopedPrisma, getTenantDb } from '@/lib/tenantDb'
import { createRateLimiter, getClientIp } from '@/lib/rateLimit'

const log = createLogger('/api/tracking')

/** Customer tracking links stay valid this long after creation (re-created on demand afterwards). */
const TRACKING_TTL_MS = 7 * 86_400_000

const TrackingCreateSchema = z.object({
  missionId: z.string().min(1).max(100),
})

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/

// Public endpoint (customers, no session) — skipped by the middleware's global limiter.
const _trackRl = createRateLimiter(60, 60_000)

/**
 * Creates (or returns the still-valid) public tracking link of a mission. Staff only — the path
 * is public in the middleware (so customers can GET), hence the explicit session check here.
 *
 * The token is 192 random bits, stored on the mission. It is deliberately NOT a signed session:
 * the previous implementation signed it with the session key (role=driver), which let any
 * customer holding a tracking link replay it as a session cookie.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookie  = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = cookie ? await verifySession(cookie) : null
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  if (!isStaff(session.role)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const tenantId = session.tenantId

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = TrackingCreateSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { missionId } = parsed.data

  const db = getTenantDb(tenantId)
  const mission = await db.mission.findFirst({
    where: { id: missionId },
    select: { id: true, trackingToken: true, trackingTokenExpiresAt: true },
  })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (mission.trackingToken && mission.trackingTokenExpiresAt && mission.trackingTokenExpiresAt > new Date()) {
    return NextResponse.json({ token: mission.trackingToken, expiresAt: mission.trackingTokenExpiresAt })
  }

  const token     = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + TRACKING_TTL_MS)

  await db.mission.update({
    where: { id: missionId },
    data:  { trackingToken: token, trackingTokenExpiresAt: expiresAt },
  })

  log.info('Tracking token created', { tenantId, missionId })
  return NextResponse.json({ token, expiresAt })
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
  const ip = getClientIp(req.headers)
  if (!(await _trackRl.check(ip))) {
    return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429, headers: _trackRl.headers(ip) })
  }

  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token requis' }, { status: 400 })
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: 'Lien de suivi invalide ou expiré' }, { status: 404 })

  try {
    // Public tracking link — tenant not yet known here, this lookup is what determines it.
    const mission = await unscopedPrisma.mission.findFirst({
      where:  { trackingToken: token },
      select: {
        id: true, type: true, address: true, clientName: true,
        estimatedDurationMin: true, completedAt: true, cancelledAt: true,
        driverComment: true, actualDurationMin: true,
        tenantId: true, latitude: true, longitude: true, date: true, trackingTokenExpiresAt: true,
      },
    })

    if (!mission || !mission.trackingTokenExpiresAt || mission.trackingTokenExpiresAt < new Date()) {
      return NextResponse.json({ error: 'Lien de suivi invalide ou expiré' }, { status: 404 })
    }

    const status = mission.completedAt ? 'completed' : mission.cancelledAt ? 'cancelled' : 'in_progress'

    let eta: { minutes: number; distanceKm: number; driverLat: number; driverLng: number; updatedAt: Date } | null = null

    if (status === 'in_progress') {
      // The mission's own date, not "today" in the server's UTC clock.
      const trackDb = getTenantDb(mission.tenantId)
      const plans = await trackDb.plan.findMany({
        where:  { date: mission.date },
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
