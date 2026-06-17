import { NextRequest, NextResponse } from 'next/server'
import { MissionSchema } from '@/lib/schemas'
import { createLogger } from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { getMission, updateMission, deleteMission } from '@/lib/data/missions'
import { redisCache } from '@/lib/redisCache'
import { auditAsync } from '@/lib/audit'

const log = createLogger('/api/missions/[id]')
type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params
  try {
    const mission = await getMission(getTenantId(req), id)
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
    return NextResponse.json(mission)
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

  const parsed = MissionSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const tenantId = getTenantId(req)
    const existing = await getMission(tenantId, id)
    const mission = await updateMission(tenantId, id, parsed.data)
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
    await Promise.all([
      ...(existing?.date && existing.date !== mission.date
        ? [redisCache.invalidate('missions', tenantId, existing.date)]
        : []),
      redisCache.invalidate('missions', tenantId, mission.date),
      redisCache.invalidate('missions', tenantId, 'all'),
    ])
    auditAsync(req, 'mission.update', 'Mission', id, parsed.data as Record<string, unknown>)
    return NextResponse.json(mission)
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

    const existing = await getMission(tenantId, id)
    const ok = await deleteMission(tenantId, id)
    if (!ok) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
    await Promise.all([
      ...(existing ? [redisCache.invalidate('missions', tenantId, existing.date)] : []),
      redisCache.invalidate('missions', tenantId, 'all'),
    ])
    auditAsync(req, 'mission.delete', 'Mission', id, { address: existing?.address, date: existing?.date })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
