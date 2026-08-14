import { NextRequest, NextResponse } from 'next/server'
import { ExutoireSchema }            from '@/lib/schemas'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { getAllExutoires, createExutoire } from '@/lib/data/exutoires'
import { redisCache }                from '@/lib/redisCache'
import { hasPermission }             from '@/lib/permissions'

const log = createLogger('/api/exutoires')

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  try {

    const exutoires = await redisCache.getOrSet(
      'exutoires',
      tenantId,
      () => getAllExutoires(tenantId),
      60_000,
    )
    return NextResponse.json(exutoires, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId, role } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_exutoires'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = ExutoireSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const exutoire = await createExutoire(tenantId, parsed.data)

    await redisCache.invalidateAll('exutoires', tenantId)
    return NextResponse.json(exutoire, { status: 201, headers: { 'Cache-Control': 'no-cache' } })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
