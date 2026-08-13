import { NextRequest, NextResponse }                        from 'next/server'
import { ExutoireSchema }                                    from '@/lib/schemas'
import { createLogger }                                      from '@/lib/logger'
import { getTenantId, getRequestContext }                     from '@/lib/data/context'
import { getExutoire, updateExutoire, deleteExutoire }      from '@/lib/data/exutoires'
import { redisCache } from '@/lib/redisCache'
import { hasPermission } from '@/lib/permissions'

const log = createLogger('/api/exutoires/[id]')

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const tenantId = getTenantId(req)
  try {
    const e = await getExutoire(tenantId, id)
    if (!e) return NextResponse.json({ error: 'Exutoire introuvable' }, { status: 404 })
    return NextResponse.json(e)
  } catch (err) {
    log.error('GET failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const { tenantId, userId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  if (!(await hasPermission(userId, role, 'manage_exutoires'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = ExutoireSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const e = await updateExutoire(tenantId, id, parsed.data)
    if (!e) return NextResponse.json({ error: 'Exutoire introuvable' }, { status: 404 })
    await redisCache.invalidateAll('exutoires', tenantId)
    return NextResponse.json(e)
  } catch (err) {
    log.error('PUT failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }   = await params
  const { tenantId, userId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  if (!(await hasPermission(userId, role, 'manage_exutoires'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }
  try {
    const ok = await deleteExutoire(tenantId, id)
    if (!ok) return NextResponse.json({ error: 'Exutoire introuvable' }, { status: 404 })
    await redisCache.invalidateAll('exutoires', tenantId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
