import { apiRoute, conflict } from '@/lib/api/route'
import { ContainerTypeSchema } from '@/lib/containers/schemas'

/** Bin types of the fleet, with how many bins of each type are available right now. */
export const GET = apiRoute({ name: '/api/container-types' }, async ({ db }) => {
  const [types, counts] = await Promise.all([
    db.containerType.findMany({ where: { archived: false }, orderBy: [{ capacityM3: 'asc' }, { name: 'asc' }] }),
    db.container.groupBy({ by: ['typeId', 'status'], where: { archived: false }, _count: { _all: true } }),
  ])
  const byType = new Map<string, Record<string, number>>()
  for (const c of counts) {
    const m = byType.get(c.typeId) ?? {}
    m[c.status] = c._count._all
    byType.set(c.typeId, m)
  }
  return { data: types.map(t => ({ ...t, counts: byType.get(t.id) ?? {} })) }
})

export const POST = apiRoute({ name: '/api/container-types', permission: 'manage_vehicles', schema: ContainerTypeSchema }, async ({ db, body }) => {
  const existing = await db.containerType.findFirst({ where: { name: body.name }, select: { id: true, archived: true } })
  if (existing && !existing.archived) throw conflict(`Le type « ${body.name} » existe déjà`)
  if (existing) return db.containerType.update({ where: { id: existing.id }, data: { ...body, archived: false } })
  return db.containerType.create({ data: body as Parameters<typeof db.containerType.create>[0]['data'] })
})
