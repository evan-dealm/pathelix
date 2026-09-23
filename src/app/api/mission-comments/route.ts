import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenantDb } from '@/lib/tenantDb'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'

const log = createLogger('/api/mission-comments')

const CommentSchema = z.object({
  missionId: z.string().min(1),
  content:   z.string().min(1).max(2000),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId  = getTenantId(req)
  const missionId = req.nextUrl.searchParams.get('missionId')
  if (!missionId) return NextResponse.json({ error: 'missionId requis' }, { status: 400 })

  try {
    const comments = await getTenantDb(tenantId).missionComment.findMany({
      where:   { missionId },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(comments)
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId, role } = getRequestContext(req)

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = CommentSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    const db = getTenantDb(tenantId)
    const mission = await db.mission.findFirst({ where: { id: parsed.data.missionId } })
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

    const comment = await db.missionComment.create({
      data: { userId, role, ...parsed.data } as Parameters<typeof db.missionComment.create>[0]['data'],
    })
    return NextResponse.json(comment, { status: 201 })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
