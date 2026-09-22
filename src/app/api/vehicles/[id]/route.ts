import { NextRequest, NextResponse } from 'next/server'
import { VehicleSchema }             from '@/lib/schemas'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { redisCache }                from '@/lib/redisCache'
import { getVehicleStore }           from '../_store'
import { getTenantDb }               from '@/lib/tenantDb'
import { auditAsync }                from '@/lib/audit'
import { hasPermission }             from '@/lib/permissions'

const log    = createLogger('/api/vehicles/[id]')
const useMock = process.env.USE_MOCK_DATA !== 'false'
type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const tenantId = getTenantId(req)

  if (useMock) {
    const v = getVehicleStore().find(v => v.id === id && v.tenantId === tenantId && !v.archived)
    if (!v) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })
    return NextResponse.json(v)
  }

  try {
    const vehicle = await getTenantDb(tenantId).vehicle.findFirst({ where: { id } })
    if (!vehicle) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })

    metrics.increment(METRIC.API_REQUESTS, { route: '/api/vehicles/[id]', method: 'GET', status: '200' })
    return NextResponse.json(vehicle)
  } catch (err) {
    log.error('GET failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/vehicles/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const { tenantId, userId, role } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_vehicles'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = VehicleSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  if (useMock) {
    const store = getVehicleStore()
    const idx   = store.findIndex(v => v.id === id && v.tenantId === tenantId)
    if (idx === -1) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })
    const { assignedDriverId, ...rest } = parsed.data as Record<string, unknown> & { assignedDriverId?: string }
    store[idx] = { ...store[idx], ...rest, assignedDriverId: assignedDriverId ?? store[idx].assignedDriverId, updatedAt: new Date().toISOString() }
    return NextResponse.json(store[idx])
  }

  try {
    const db = getTenantDb(tenantId)
    const { assignedDriverId, ...rest } = parsed.data as Record<string, unknown> & { assignedDriverId?: string }
    const data: Record<string, unknown> = { ...rest }
    if (assignedDriverId !== undefined) {
      if (assignedDriverId) {
        // Same tenant-aware verification as POST — assignedDriverId has no tenant-scoped FK.
        const driver = await db.driver.findFirst({ where: { id: assignedDriverId }, select: { id: true } })
        if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable pour ce tenant' }, { status: 422 })
        data.assignedDriver = { connect: { id: assignedDriverId } }
      } else {
        data.assignedDriver = { disconnect: true }
      }
    }

    const vehicle = await db.vehicle.update({
      where: { id },
      data,
    })

    void redisCache.invalidateAll('vehicles', tenantId)
    auditAsync(req, 'vehicle.update', 'Vehicle', id, {})
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/vehicles/[id]', method: 'PUT', status: '200' })
    return NextResponse.json(vehicle)
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })
    }
    if (err instanceof Error && (err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Un véhicule avec cette immatriculation existe déjà' }, { status: 409 })
    }
    log.error('PUT failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/vehicles/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const { tenantId, userId, role } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_vehicles'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  if (useMock) {
    const store = getVehicleStore()
    const idx   = store.findIndex(v => v.id === id && v.tenantId === tenantId)
    if (idx === -1) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })
    store[idx] = { ...store[idx], archived: true }
    return NextResponse.json({ ok: true })
  }

  try {
    const result = await getTenantDb(tenantId).vehicle.updateMany({ where: { id }, data: { archived: true } })
    if (result.count === 0) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })

    void redisCache.invalidateAll('vehicles', tenantId)
    auditAsync(req, 'vehicle.delete', 'Vehicle', id, {})
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/vehicles/[id]', method: 'DELETE', status: '200' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/vehicles/[id]', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
