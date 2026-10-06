import { NextRequest, NextResponse } from 'next/server'
import { hasPermission } from '@/lib/permissions'
import { getTenantDb } from '@/lib/tenantDb'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { redisCache } from '@/lib/redisCache'
import { MaintenanceSchema } from '@/lib/fleet/schemas'
import { recordMaintenance } from '@/lib/fleet/service'

const log = createLogger('/api/maintenance')

const MAINT_SELECT = {
  id:          true,
  vehicleId:   true,
  type:        true,
  description: true,
  costEur:     true,
  mileageKm:   true,
  doneAt:      true,
  doneBy:      true,
  notes:       true,
  createdAt:   true,
} as const


export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId  = getTenantId(req)
  const vehicleId = req.nextUrl.searchParams.get('vehicleId') ?? undefined
  const limit     = Math.min(parseInt(req.nextUrl.searchParams.get('limit')  ?? '50', 10), 100)
  const offset    = Math.max(parseInt(req.nextUrl.searchParams.get('offset') ?? '0',   10), 0)
  const qualifier = vehicleId ?? 'all'

  try {
    const records = await redisCache.getOrSet(
      'maintenance',
      tenantId,
      () => getTenantDb(tenantId).maintenanceRecord.findMany({
        where:   { ...(vehicleId ? { vehicleId } : {}) },
        orderBy: { doneAt: 'desc' },
        take:    limit,
        skip:    offset,
        select:  MAINT_SELECT,
      }),
      30_000,
      `${qualifier}:${limit}:${offset}`,
    )
    return NextResponse.json(records, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  // Same permission as managing the vehicle itself (dispatchers hold it by default).
  if (!(await hasPermission(userId, role, 'manage_vehicles'))) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = MaintenanceSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    // Plan restarts, odometer, repaired defects and legacy CT/insurance dates follow in one go.
    const created = await recordMaintenance(getTenantDb(tenantId), userId, parsed.data)
    if (!created) return NextResponse.json({ error: 'Véhicule ou suivi introuvable' }, { status: 404 })
    const record = Object.fromEntries(Object.keys(MAINT_SELECT).map(k => [k, (created as Record<string, unknown>)[k]]))
    void redisCache.invalidateAll('maintenance', tenantId)
    return NextResponse.json(record, { status: 201 })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
