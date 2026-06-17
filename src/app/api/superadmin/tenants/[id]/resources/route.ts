import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'

const log = createLogger('/api/superadmin/tenants/[id]/resources')

type Params = { params: Promise<{ id: string }> }

const ENTITIES = ['driver', 'client', 'vehicle', 'exutoire', 'site', 'mission', 'missionTemplate'] as const
type EntityType = typeof ENTITIES[number]

type PrismaDelegate = {
  create(_args: { data: Record<string, unknown> }): Promise<{ id: string } & Record<string, unknown>>
  update(_args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>
  delete(_args: { where: { id: string } }): Promise<unknown>
  findUnique(_args: { where: { id: string }; select: Record<string, boolean> }): Promise<{ id: string; tenantId: string } | null>
}

const ResourceSchema = z.object({
  entity: z.enum(ENTITIES),
  action: z.enum(['create', 'update', 'delete'] as const),
  id: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})

function getModel(entity: EntityType): PrismaDelegate {
  const map: Record<EntityType, PrismaDelegate> = {
    driver:          prisma.driver          as unknown as PrismaDelegate,
    client:          prisma.client          as unknown as PrismaDelegate,
    vehicle:         prisma.vehicle         as unknown as PrismaDelegate,
    exutoire:        prisma.exutoire        as unknown as PrismaDelegate,
    site:            prisma.site            as unknown as PrismaDelegate,
    mission:         prisma.mission         as unknown as PrismaDelegate,
    missionTemplate: prisma.missionTemplate as unknown as PrismaDelegate,
  }
  return map[entity]
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {

  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  const { id: tenantId } = await params

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = ResourceSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { entity, action, id, data } = parsed.data
  const model = getModel(entity)

  try {

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })

    let result: unknown

    if (action === 'create') {
      if (!data) return NextResponse.json({ error: 'data requis pour create' }, { status: 422 })

      const cleanData: Record<string, unknown> = { ...data }
      delete cleanData.id
      delete cleanData.createdAt
      delete cleanData.updatedAt
      cleanData.tenantId = tenantId
      result = await model.create({ data: cleanData })
      log.info('SuperAdmin resource created', { tenantId, entity, resourceId: (result as { id: string }).id })
    }

    else if (action === 'update') {
      if (!id || !data) return NextResponse.json({ error: 'id et data requis pour update' }, { status: 422 })

      const existing = await model.findUnique({ where: { id }, select: { tenantId: true } })
      if (!existing || existing.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Ressource introuvable dans ce tenant' }, { status: 404 })
      }
      const cleanData: Record<string, unknown> = { ...data }
      delete cleanData.id
      delete cleanData.tenantId
      delete cleanData.createdAt
      delete cleanData.updatedAt
      result = await model.update({ where: { id }, data: cleanData })
      log.info('SuperAdmin resource updated', { tenantId, entity, resourceId: id })
    }

    else if (action === 'delete') {
      if (!id) return NextResponse.json({ error: 'id requis pour delete' }, { status: 422 })

      const existing = await model.findUnique({ where: { id }, select: { tenantId: true } })
      if (!existing || existing.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Ressource introuvable dans ce tenant' }, { status: 404 })
      }
      result = await model.delete({ where: { id } })
      log.info('SuperAdmin resource deleted', { tenantId, entity, resourceId: id })
    }

    return NextResponse.json({ ok: true, result })
  } catch (err) {
    log.error('Resource action failed', { tenantId, entity, action, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
