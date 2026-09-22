import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { publishStatusUpdate } from '@/lib/driverStatusPubSub'
import { collectInterventionMetric } from '@/lib/metricCollector'
import { emitEvent } from '@/lib/integrationEvents'
import { syncMissionToERP } from '@/lib/integrationERP'
import { withIdempotency } from '@/lib/idempotency'

const log = createLogger('/api/driver-status/update')

const StatusUpdateSchema = z.object({
  driverId:   z.string().min(1),
  missionId:  z.string().min(1),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status:     z.enum(['todo', 'en_route', 'arrived', 'started', 'done']),
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

    const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { tenantId: true, firstName: true, lastName: true } })
    if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })

    const tenantId = driver.tenantId
    const driverFullName = `${driver.firstName ?? ''} ${driver.lastName ?? ''}`.trim() || driverId

    const isOwnDriver = session.driverRef === driverId || session.sub === driverId
    const isAdminOrDispatcher = (session.role === 'admin' || session.role === 'dispatcher') && session.tenantId === tenantId
    if (!isOwnDriver && !isAdminOrDispatcher) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    return await withIdempotency(req, tenantId, 'POST /api/driver-status/update', () => handleStatusUpdate({
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
  status: 'todo' | 'en_route' | 'arrived' | 'started' | 'done'
  timestamp?: string
  latitude?: number
  longitude?: number
  driverFullName: string
}

async function handleStatusUpdate({
  tenantId, driverId, missionId, date, status, timestamp, latitude, longitude, driverFullName,
}: StatusUpdateParams): Promise<NextResponse> {
  try {
    const ts = timestamp || new Date().toISOString()

    let capturedStatuses: Record<string, unknown> | null = null
    await prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findFirst({ where: { tenantId, driverId, date } })
      if (!plan) return

      const statuses = (typeof plan.statuses === 'object' && plan.statuses !== null)
        ? { ...(plan.statuses as Record<string, unknown>) }
        : {}

      const prev = (statuses[missionId] as Record<string, unknown>) || {}
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

      capturedStatuses = statuses
    })

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: driverId,
        action: 'status_update',
        entityType: 'mission',
        entityId: missionId,
        changes: { status, timestamp: ts, latitude: latitude ?? null, longitude: longitude ?? null } as Parameters<typeof prisma.auditLog.create>[0]['data']['changes'],
      },
    })

    log.info('Status updated', { driverId, missionId, status, date })

    if (status === 'done') {
      void emitEvent(tenantId, 'mission.done', { missionId, driverId, driverName: driverFullName, date, status })

      const missionForERP = await prisma.mission.findFirst({
        where: { id: missionId, tenantId },
        select: { type: true, clientName: true, wasteTypeLabel: true, address: true },
      }).catch(() => null)

      if (capturedStatuses) {
        void collectInterventionMetric({
          tenantId,
          driverId,
          missionId,
          date,
          statuses: capturedStatuses as Record<string, { status: string; en_routeAt?: string; arrivedAt?: string; startedAt?: string; doneAt?: string; lat?: number; lng?: number }>,
        })
      }

      void syncMissionToERP({
        tenantId, missionId,
        missionType: missionForERP?.type ?? '',
        clientName: missionForERP?.clientName ?? '',
        wasteType: missionForERP?.wasteTypeLabel ?? undefined,
        date,
        driverName: driverFullName,
        durationMin: 0,
      })
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
