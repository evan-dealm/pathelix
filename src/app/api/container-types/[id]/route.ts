import { apiRoute, notFound, unprocessable } from '@/lib/api/route'
import { ContainerTypeSchema } from '@/lib/containers/schemas'

export const PUT = apiRoute({ name: '/api/container-types/[id]', permission: 'manage_vehicles', schema: ContainerTypeSchema.partial() }, async ({ db, body, params }) => {
  const t = await db.containerType.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!t) throw notFound('Type de contenant')
  return db.containerType.update({ where: { id: t.id }, data: body })
})

/** Archived only when no bin in service still uses it. */
export const DELETE = apiRoute({ name: '/api/container-types/[id]', permission: 'manage_vehicles' }, async ({ db, params }) => {
  const t = await db.containerType.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!t) throw notFound('Type de contenant')
  const inUse = await db.container.count({ where: { typeId: t.id, archived: false } })
  if (inUse > 0) throw unprocessable(`${inUse} benne(s) de ce type sont encore au parc`, 'IN_USE')
  await db.containerType.update({ where: { id: t.id }, data: { archived: true } })
  return { ok: true }
})
