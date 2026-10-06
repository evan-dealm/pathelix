import { apiRoute } from '@/lib/api/route'

/** Customer requests from the portal, newest first (status filter: NEW by default). */
export const GET = apiRoute({ name: '/api/portal-requests', permission: 'manage_missions' }, async ({ db, req }) => {
  const status = req.nextUrl.searchParams.get('status') ?? 'NEW'
  const rows = await db.portalRequest.findMany({
    where: status === 'ALL' ? {} : { status },
    orderBy: { createdAt: 'desc' }, take: 100,
    include: { client: { select: { id: true, name: true } } },
  })
  const containerIds = rows.map(r => r.containerId).filter((x): x is string => !!x)
  const siteIds = rows.map(r => r.siteId).filter((x): x is string => !!x)
  const [containers, sites] = await Promise.all([
    containerIds.length ? db.container.findMany({ where: { id: { in: containerIds } }, select: { id: true, number: true, type: { select: { name: true } } } }) : [],
    siteIds.length ? db.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true, address: true } }) : [],
  ])
  const cById = new Map(containers.map(c => [c.id, c]))
  const sById = new Map(sites.map(s => [s.id, s]))
  return { data: rows.map(r => ({ ...r, container: r.containerId ? cById.get(r.containerId) ?? null : null, site: r.siteId ? sById.get(r.siteId) ?? null : null })) }
})
