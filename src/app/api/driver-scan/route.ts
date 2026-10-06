import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { unscopedPrisma, getTenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { withIdempotency } from '@/lib/idempotency'
import { canActForDriver } from '@/lib/driverAccess'
import { checkTenantSuspension } from '@/lib/data/context'
import { parseScannedCode, validateScan, type ScanRole } from '@/lib/containers/scan'

const log = createLogger('/api/driver-scan')

const ScanSchema = z.object({
  driverId:  z.string().min(1).max(100),
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  missionId: z.string().min(1).max(100),
  code:      z.string().trim().min(1).max(300),
  role:      z.enum(['place', 'collect']),
  latitude:  z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  scannedAt: z.string().datetime({ offset: true }).optional(),
})

/**
 * A driver scans (or types) a bin on a mission. The bin is identified, checked against the
 * mission (right bin, right size, right customer, not promised elsewhere) and linked to it; the
 * movement itself happens when the step is completed. Offline scans are queued with an
 * Idempotency-Key like every field action — a replay returns the first answer.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }
  const parsed = ScanSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const body = parsed.data

  try {
    const driver = await unscopedPrisma.driver.findUnique({ where: { id: body.driverId }, select: { tenantId: true } })
    if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    const tenantId = driver.tenantId
    if (!canActForDriver(session, body.driverId, tenantId)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    const suspended = await checkTenantSuspension(tenantId, session.role)
    if (suspended) return suspended

    return await withIdempotency(req, tenantId, 'POST /api/driver-scan', body, async () => {
      const db = getTenantDb(tenantId)
      const plan = await db.plan.findFirst({ where: { driverId: body.driverId, date: body.date }, select: { missions: true } })
      const steps = Array.isArray(plan?.missions) ? plan.missions as Array<{ id?: string }> : []
      if (!steps.some(s => s?.id === body.missionId)) {
        return NextResponse.json({ error: 'Mission absente de votre tournée', code: 'NOT_IN_PLAN' }, { status: 404 })
      }
      const mission = await db.mission.findFirst({
        where: { id: body.missionId },
        select: { id: true, type: true, containerTypeId: true, binSizeM3: true, placedContainerId: true, collectedContainerId: true, siteId: true, clientId: true },
      })
      if (!mission) return NextResponse.json({ error: 'Mission introuvable', code: 'NOT_FOUND' }, { status: 404 })

      const code = parseScannedCode(body.code)
      const c = await db.container.findFirst({
        where: code.token ? { qrToken: code.token } : { number: code.number },
        select: { id: true, number: true, typeId: true, status: true, siteId: true, clientId: true, missionId: true, driverId: true, type: { select: { name: true, capacityM3: true } } },
      })
      if (!c) return NextResponse.json({ error: 'Benne inconnue — vérifiez le numéro', code: 'UNKNOWN_CONTAINER' }, { status: 422 })

      const role = body.role as ScanRole
      const verdict = validateScan(mission, { ...c, typeName: c.type.name, capacityM3: c.type.capacityM3 }, role, body.driverId)
      const at = body.scannedAt ? new Date(body.scannedAt) : new Date()
      await db.$transaction(async tx => {
        await tx.containerEvent.create({
          data: {
            containerId: c.id, type: 'SCANNED', missionId: mission.id, driverId: body.driverId,
            latitude: body.latitude ?? null, longitude: body.longitude ?? null, at,
            notes: verdict.ok ? (role === 'place' ? 'Scan à la pose' : 'Scan au retrait') : `Refusé : ${verdict.message}`,
          } as Parameters<typeof tx.containerEvent.create>[0]['data'],
        })
        if (verdict.ok) {
          await tx.mission.update({
            where: { id: mission.id },
            data: role === 'place' ? { placedContainerId: c.id, containerTypeId: mission.containerTypeId ?? c.typeId } : { collectedContainerId: c.id },
          })
        }
      })
      if (!verdict.ok) {
        log.info('Scan refused', { tenantId, missionId: mission.id, code: verdict.code })
        return NextResponse.json({ error: verdict.message, code: verdict.code, container: { number: c.number } }, { status: 422 })
      }
      return NextResponse.json({ ok: true, role, container: { id: c.id, number: c.number, typeName: c.type.name, capacityM3: c.type.capacityM3 } })
    })
  } catch (err) {
    log.error('Scan failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
