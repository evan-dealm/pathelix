import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { unscopedPrisma, getTenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { publishStatusUpdate } from '@/lib/driverStatusPubSub'
import { collectInterventionMetric } from '@/lib/metricCollector'
import { emitEvent } from '@/lib/integrationEvents'
import { withIdempotency } from '@/lib/idempotency'
import { canActForDriver } from '@/lib/driverAccess'
import { checkTenantSuspension } from '@/lib/data/context'
import { MISSION_STATUSES, type MissionStatus } from '@/lib/missionStatus'
import { onStepStatus } from '@/lib/containers/service'
import { recordDriverWeighing } from '@/lib/sales/weighings'
import { emitBusinessEvent } from '@/lib/events/outbound'

const log = createLogger('/api/driver-status/update')

const StatusUpdateSchema = z.object({
  driverId:   z.string().min(1).max(100),
  missionId:  z.string().min(1).max(100),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Optional when only a weighing ticket is recorded on an already-finished step.
  status:     z.enum(MISSION_STATUSES).optional(),
  timestamp:  z.string().datetime({ offset: true }).optional(),
  latitude:   z.number().min(-90).max(90).optional(),
  longitude:  z.number().min(-180).max(180).optional(),
  /** Net weight from the weighing ticket (dump/VIDER steps), in kg. */
  weightKg:   z.number().positive().max(100_000).optional(),
}).refine(d => d.status !== undefined || d.weightKg !== undefined, { message: 'status ou weightKg requis' })

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

  const { driverId, missionId, date, status, timestamp, latitude, longitude, weightKg } = parsed.data

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
      tenantId, driverId, missionId, date, status, timestamp, latitude, longitude, weightKg, driverFullName,
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
  status?: MissionStatus
  weightKg?: number
  timestamp?: string
  latitude?: number
  longitude?: number
  driverFullName: string
}

type StatusEntry = { status: string; weightKg?: number; en_routeAt?: string; arrivedAt?: string; startedAt?: string; doingAt?: string; doneAt?: string; lat?: number; lng?: number }

function parsePlanSteps(missions: unknown): string[] {
  let arr = missions
  if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { return [] } }
  if (!Array.isArray(arr)) return []
  return arr.map(m => (m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined)).filter((id): id is string => typeof id === 'string')
}

function planHasMission(missions: unknown, missionId: string): boolean {
  let arr = missions
  if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { return false } }
  return Array.isArray(arr) && arr.some(m => m && typeof m === 'object' && (m as { id?: unknown }).id === missionId)
}

async function handleStatusUpdate({
  tenantId, driverId, missionId, date, status, timestamp, latitude, longitude, weightKg, driverFullName,
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
      const prevEntry = typeof prev === 'object' && prev !== null && !Array.isArray(prev) ? prev as Record<string, unknown> : {}
      statuses[missionId] = {
        ...prevEntry,
        status: status ?? prevEntry.status ?? 'todo',
        ...(status ? { [`${status}At`]: ts } : {}),
        ...(weightKg !== undefined ? { weightKg, weighedAt: ts } : {}),
        ...(latitude !== undefined ? { lat: latitude, lng: longitude } : {}),
      }

      await tx.plan.update({
        where: { id: plan.id },
        data: { statuses: statuses as Parameters<typeof tx.plan.update>[0]['data']['statuses'] },
      })
      // The mission row records its completion too (reports, tracking page, billing read it —
      // it used to stay null forever). Synthetic steps have no row: nothing is updated.
      if (status === 'done') {
        await tx.mission.updateMany({ where: { id: missionId, completedAt: null }, data: { completedAt: new Date(ts) } })
      }

      // Same transaction as the status write: a crash between the two must not leave a
      // persisted status with no audit row.
      await tx.auditLog.create({
        data: {
          userId: driverId,
          action: status ? 'status_update' : 'weight_recorded',
          entityType: 'mission',
          entityId: missionId,
          changes: { status: status ?? null, weightKg: weightKg ?? null, timestamp: ts, latitude: latitude ?? null, longitude: longitude ?? null },
        } as Parameters<typeof tx.auditLog.create>[0]['data'],
      })

      return { kind: 'ok' as const, statuses: statuses as Record<string, StatusEntry>, planMissions: plan.missions }
    })

    if (outcome.kind === 'no-plan') {
      return NextResponse.json({ error: 'Aucune tournée enregistrée pour ce chauffeur à cette date' }, { status: 404 })
    }
    if (outcome.kind === 'not-in-plan') {
      return NextResponse.json({ error: 'Mission absente de la tournée de ce chauffeur' }, { status: 404 })
    }

    log.info('Status updated', { driverId, missionId, status, weightKg, date })
    // The ticket's weight becomes a Weighing (billing per tonne, BSD, weight calibration).
    if (weightKg !== undefined) {
      try {
        const weighingId = await recordDriverWeighing(db, { driverId, stepId: missionId, netKg: weightKg, at: new Date(ts) })
        if (weighingId) void emitBusinessEvent(tenantId, 'weighing.created', { weighingId, stepId: missionId, netKg: weightKg })
      } catch (err) {
        log.error('Weighing record failed', { missionId, err: err instanceof Error ? err.message : String(err) })
      }
    }
    // Weight-only update on an already-reported step: no status side effects to replay.
    if (!status) return NextResponse.json({ ok: true, weightKg, timestamp: ts })

    // Bins follow the field (pose → at the customer, retrait → on the truck, exutoire → emptied).
    // Done after the status commit and never failing it: the driver's action is recorded even if
    // the inventory update has to be corrected by hand.
    if (status === 'done' || status === 'en_route') {
      try {
        const steps = parsePlanSteps(outcome.planMissions)
        const doneIds = new Set(Object.entries(outcome.statuses).filter(([, s]) => s?.status === 'done').map(([id]) => id))
        const moved = await db.$transaction(tx => onStepStatus(tx, {
          driverId, stepId: missionId, status, planStepIds: steps, doneStepIds: doneIds, at: new Date(ts), latitude, longitude,
        }))
        for (const e of moved) {
          if (e.event === 'PLACED') void emitBusinessEvent(tenantId, 'container.placed', { containerId: e.containerId, missionId, clientId: e.patch.clientId, siteId: e.patch.siteId })
          if (e.event === 'PICKED_UP') void emitBusinessEvent(tenantId, 'container.removed', { containerId: e.containerId, missionId })
        }
      } catch (err) {
        log.error('Container update after status failed', { missionId, status, err: err instanceof Error ? err.message : String(err) })
      }
    }

    if (status === 'done') {
      void emitEvent(tenantId, 'mission.done', { missionId, driverId, driverName: driverFullName, date, status })
      if (!missionId.startsWith('_')) void emitBusinessEvent(tenantId, 'mission.completed', { missionId, driverId, date, completedAt: ts })

      void collectInterventionMetric({ tenantId, driverId, missionId, date, statuses: outcome.statuses })
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
