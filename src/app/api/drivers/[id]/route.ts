import { NextRequest, NextResponse } from 'next/server'
import { DriverSchema } from '@/lib/schemas'
import { createLogger } from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { getDriver, updateDriver, deleteDriver } from '@/lib/data/drivers'
import { redisCache } from '@/lib/redisCache'
import { auditAsync } from '@/lib/audit'

const log = createLogger('/api/drivers/[id]')
type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  try {
    const driver = await getDriver(getTenantId(req), id)
    if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    return NextResponse.json(driver)
  } catch (err) {
    log.error('GET failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = DriverSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const tenantId = getTenantId(req)
    const driver = await updateDriver(tenantId, id, parsed.data)
    if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    await Promise.all([
      redisCache.invalidateAll('drivers', tenantId),
      redisCache.invalidateAll('driver-list', tenantId),
    ])
    auditAsync(req, 'driver.update', 'Driver', id, parsed.data as Record<string, unknown>)
    return NextResponse.json(driver)
  } catch (err) {
    log.error('PUT failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  const { tenantId, role } = getRequestContext(req)
  if (role === 'dispatcher') return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  try {
    const ok = await deleteDriver(tenantId, id)
    if (!ok) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    await Promise.all([
      redisCache.invalidateAll('drivers', tenantId),
      redisCache.invalidateAll('driver-list', tenantId),
    ])
    auditAsync(req, 'driver.delete', 'Driver', id, {})
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
