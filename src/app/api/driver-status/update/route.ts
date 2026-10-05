import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { unscopedPrisma, getTenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { publishStatusUpdate } from '@/lib/driverStatusPubSub'
import { collectInterventionMetric } from '@/lib/metricCollector'
import { emitEvent } from '@/lib/integrationEvents'
import { syncMissionToERP } from '@/lib/integrationERP'
import { withIdempotency } from '@/lib/idempotency'
import { canActForDriver } from '@/lib/driverAccess'
import { checkTenantSuspension } from '@/lib/data/context'
import { MISSION_STATUSES, type MissionStatus } from '@/lib/missionStatus'

const log = createLogger('/api/driver-status/update')

const StatusUpdateSchema = z.object({
  driverId:   z.string().min(1).max(100),
  missionId:  z.string().min(1).max(100),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status:     z.enum(MISSION_STATUSES),
  timestamp:  z.string().datetime({ offset: true }).optional(),
  latitude:   z.number().min(-90).max(90).optional(),
  longitude:  z.number().min(-180).max(180).optional(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {

  const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null
  if (!session) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = StatusUpdateSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { driverId, missionId, date, status, timestamp, latitude, longitude } = parsed.data

  try {

    // Tenant not yet known here — this lookup is what determines it.
    const driver = await unscopedPrisma.driver.findUnique({ where: { id: driverId }, select: { tenantId: true, firstName: true, lastName: true } })
    if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })

    const tenantId = driver.tenantId
    const driverFullName = `${driver.firstName ?? ''} ${driver.lastName ?? ''}`.trim() || driverId

    if (!canActForDriver(session, driverId, tenantId)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    const suspended = await checkTenantSuspension(tenantId, session.role)
    if (suspended) return suspended

    return await withIdempotency(req, tenantId, 'POST /api/driver-status/update', parsed.data, () => handleStatusUpdate({
      tenantId, driverId, missionId, date, status, timestamp, latitude, longitude, driverFullName,
    }))
  } catch (err) {
    log.error('Status update failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

interface StatusUpdateParams {
  tenantId: string
  driverId: string
  missionId: string
  date: string
  status: MissionStatus
  timestamp?: string
  latitude?: number
  longitude?: number
  driverFullName: string
}

type StatusEntry = { status: string; en_routeAt?: string; arrivedAt?: string; startedAt?: string; doingAt?: string; doneAt?: string; lat?: number; lng?: number }

function planHasMission(missions: unknown, missionId: string): boolean {
  let arr = missions
  if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { return false } }
  return Array.isArray(arr) && arr.some(m => m && typeof m === 'object' && (m as { id?: unknown }).id === missionId)
}

async function handleStatusUpdate({
  tenantId, driverId, missionId, date, status, timestamp, latitude, longitude, driverFullName,
}: StatusUpdateParams): Promise<NextResponse> {
  try {
    const ts = timestamp || new Date().toISOString()

    const db = getTenantDb(tenantId)
    const outcome = await db.$transaction(async (tx) => {
      const found = await tx.plan.findFirst({ where: { driverId, date }, select: { id: true } })
      if (!found) return { kind: 'no-plan' as const }
      // Row lock before the read-modify-write of the statuses JSON: two concurrent updates for
      // the same driver/day (offline queue flush + dispatcher, two tabs) would otherwise both
      // read the same snapshot under READ COMMITTED and the second write would drop the
      // first mission's status. The id is already tenant-verified by the scoped findFirst.
      await tx.$queryRaw`SELECT 1 FROM "Plan" WHERE id = ${found.id} FOR UPDATE`
      const plan = await tx.plan.findFirst({ where: { id: found.id }, select: { id: true, missions: true, statuses: true } })
      if (!plan) return { kind: 'no-plan' as const }
      // A status may only be set on a mission of THIS driver's plan — never on any mission id of
      // the tenant (which would also fire the ERP sync / events for someone else's mission).
      if (!planHasMission(plan.missions, missionId)) return { kind: 'not-in-plan' as const }

      const statuses = (typeof plan.statuses === 'object' && plan.statuses !== null && !Array.isArray(plan.statuses))
        ? { ...(plan.statuses as Record<string, unknown>) }
        : {}

      const prev = statuses[missionId]
      statuses[missionId] = {
        ...(typeof prev === 'object' && prev !== null && !Array.isArray(prev) ? prev : {}),
        status,
        [`${status}At`]: ts,
        ...(latitude !== undefined ? { lat: latitude, lng: longitude } : {}),
      }

      await tx.plan.update({
        where: { id: plan.id },
        data: { statuses: statuses as Parameters<typeof tx.plan.update>[0]['data']['statuses'] },
      })

      // Same transaction as the status write: a crash between the two must not leave a
      // persisted status with no audit row.
      await tx.auditLog.create({
        data: {
          userId: driverId,
          action: 'status_update',
          entityType: 'mission',
          entityId: missionId,
          changes: { status, timestamp: ts, latitude: latitude ?? null, longitude: longitude ?? null },
        } as Parameters<typeof tx.auditLog.create>[0]['data'],
      })

      return { kind: 'ok' as const, statuses: statuses as Record<string, StatusEntry> }
    })

    if (outcome.kind === 'no-plan') {
      return NextResponse.json({ error: 'Aucune tournée enregistrée pour ce chauffeur à cette date' }, { status: 404 })
    }
    if (outcome.kind === 'not-in-plan') {
      return NextResponse.json({ error: 'Mission absente de la tournée de ce chauffeur' }, { status: 404 })
    }

    log.info('Status updated', { driverId, missionId, status, date })

    if (status === 'done') {
      void emitEvent(tenantId, 'mission.done', { missionId, driverId, driverName: driverFullName, date, status })

      const missionForERP = await db.mission.findFirst({
        where: { id: missionId },
        select: { type: true, clientName: true, wasteTypeLabel: true, address: true },
      }).catch(() => null)

      void collectInterventionMetric({ tenantId, driverId, missionId, date, statuses: outcome.statuses })

      // Synthetic steps (VIDER/PAUSE) have no Mission row and nothing to sync.
      if (missionForERP) {
        void syncMissionToERP({
          tenantId, missionId,
          missionType: missionForERP.type,
          clientName: missionForERP.clientName ?? '',
          wasteType: missionForERP.wasteTypeLabel ?? undefined,
          date,
          driverName: driverFullName,
          durationMin: 0,
        })
      }
    }
    if (status === 'en_route') {
      void emitEvent(tenantId, 'driver.en_route', { missionId, driverId, driverName: driverFullName, date })
    }

    publishStatusUpdate({
      tenantId,
      driverId,
      missionId,
      date,
      status,
      timestamp: ts,
      latitude,
      longitude,
    })

    return NextResponse.json({ ok: true, status, timestamp: ts })
  } catch (err) {
    log.error('Status update failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
