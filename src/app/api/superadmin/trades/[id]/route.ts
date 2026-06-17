import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'

const log = createLogger('/api/superadmin/trades/[id]')

type Params = { params: Promise<{ id: string }> }

const UpdateTradeSchema = z.object({
  tradeName:           z.string().min(1).max(100).optional(),
  tradeDescription:    z.string().max(500).optional(),
  tradeIcon:           z.string().max(10).optional(),
  vocabulary:          z.record(z.string(), z.unknown()).optional(),
  enabledMissionTypes: z.array(z.string()).min(1).optional(),
})

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  const { id } = await params

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = UpdateTradeSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    const updateData: Record<string, unknown> = { ...parsed.data }
    if (updateData.vocabulary) updateData.vocabulary = updateData.vocabulary as object
    if (updateData.enabledMissionTypes) updateData.enabledMissionTypes = updateData.enabledMissionTypes as string[]
    const trade = await prisma.customTrade.update({
      where: { id },
      data: updateData,
    })

    log.info('Custom trade updated', { id, keys: Object.keys(parsed.data) })
    return NextResponse.json(trade)
  } catch (err) {
    if (err instanceof Error && err.message.includes('Record to update not found')) {
      return NextResponse.json({ error: 'Métier introuvable' }, { status: 404 })
    }
    log.error('PUT failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  const { id } = await params

  try {

    const trade = await prisma.customTrade.findUnique({ where: { id }, select: { tradeKey: true } })
    if (!trade) return NextResponse.json({ error: 'Métier introuvable' }, { status: 404 })

    const usingTenants = await prisma.tenant.count({ where: { trade: trade.tradeKey } })
    if (usingTenants > 0) {
      return NextResponse.json({
        error: `Ce métier est utilisé par ${usingTenants} tenant(s). Changez leur métier avant de le supprimer.`,
      }, { status: 409 })
    }

    await prisma.customTrade.delete({ where: { id } })

    log.info('Custom trade deleted', { id, tradeKey: trade.tradeKey })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { id, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
