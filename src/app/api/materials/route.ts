import { apiRoute, conflict } from '@/lib/api/route'
import { MaterialSchema } from '@/lib/schemas'

/** Materials (matières) of the tenant — densities feed the weight estimates of the optimiser. */
export const GET = apiRoute({ name: '/api/materials' }, async ({ db, req }) => {
  const includeArchived = req.nextUrl.searchParams.get('archived') === '1'
  const data = await db.material.findMany({
    where: includeArchived ? {} : { archived: false },
    orderBy: { name: 'asc' },
  })
  return { data }
})

export const POST = apiRoute({ name: '/api/materials', permission: 'manage_exutoires', schema: MaterialSchema }, async ({ db, body }) => {
  const existing = await db.material.findFirst({ where: { name: body.name }, select: { id: true, archived: true } })
  if (existing && !existing.archived) throw conflict(`La matière « ${body.name} » existe déjà`)
  if (existing) return db.material.update({ where: { id: existing.id }, data: { ...body, archived: false } })
  return db.material.create({ data: body as Parameters<typeof db.material.create>[0]['data'] })
})
