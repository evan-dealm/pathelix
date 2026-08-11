import { NextRequest, NextResponse }  from 'next/server'
import { getRequestContext }         from '@/lib/data/context'
import { createLogger }              from '@/lib/logger'
import { redisCache }                from '@/lib/redisCache'
import { TemplateSchema }            from '../route'
import prisma                        from '@/lib/db'

const log = createLogger('/api/templates/[id]')

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }             = await params
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = TemplateSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  const allowed = [
    'label', 'type', 'recurrence', 'address', 'latitude', 'longitude',
    'startDate', 'endDate', 'enabled', 'clientName', 'estimatedDurationMin',
    'maneuverTimeMin', 'wasteTypeLabel', 'binSize', 'binSizeM3',
    'accessNotes', 'priority', 'timeWindow', 'linkedExutoireId',
  ] as const
  const validated = parsed.data as Record<string, unknown>
  for (const key of allowed) {
    if (key in body) data[key] = validated[key] ?? null
  }

  try {
    const template = await prisma.missionTemplate.update({
      where: { id, tenantId },
      data,
    })
    void redisCache.invalidateAll('templates', tenantId)
    return NextResponse.json(template)
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Template introuvable' }, { status: 404 })
    }
    log.error('PUT failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id }             = await params
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }

  try {
    await prisma.missionTemplate.delete({ where: { id, tenantId } })
    void redisCache.invalidateAll('templates', tenantId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Template introuvable' }, { status: 404 })
    }
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
