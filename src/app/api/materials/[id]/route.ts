import { apiRoute, notFound } from '@/lib/api/route'
import { MaterialSchema } from '@/lib/schemas'

export const PUT = apiRoute({ name: '/api/materials/[id]', permission: 'manage_exutoires', schema: MaterialSchema.partial() }, async ({ db, body, params }) => {
  const existing = await db.material.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!existing) throw notFound('Matière')
  return db.material.update({ where: { id: params.id }, data: body })
})

/** Archived, not deleted: missions and weighings keep their reference. */
export const DELETE = apiRoute({ name: '/api/materials/[id]', permission: 'manage_exutoires' }, async ({ db, params }) => {
  const existing = await db.material.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!existing) throw notFound('Matière')
  await db.material.update({ where: { id: params.id }, data: { archived: true } })
  return { ok: true }
})
