import { apiRoute, paged, pagination, unprocessable } from '@/lib/api/route'
import { ContainerCreateSchema } from '@/lib/containers/schemas'
import { CONTAINER_STATUSES, daysOnSite, type ContainerStatus } from '@/lib/containers/lifecycle'
import { newQrToken, nextNumbers } from '@/lib/containers/numbers'
import { assertTenantRefs } from '@/lib/tenantRefs'

const SORTS = {
  number:       { number: 'asc' },
  '-number':    { number: 'desc' },
  daysOnSite:   { placedAt: 'asc' },     // longest on site first
  rotation:     { lastRotationAt: 'asc' }, // least recently rotated first
  '-movement':  { lastMovementAt: 'desc' },
} as const

/**
 * Fleet inventory. Filters: q (number, client, site, location), status (comma list), typeId,
 * clientId, siteId, minDays (on site for at least N days), sort (number | daysOnSite | rotation).
 */
export const GET = apiRoute({ name: '/api/containers' }, async ({ db, req }) => {
  const { page, limit, skip } = pagination(req)
  const sp = req.nextUrl.searchParams
  const where: Record<string, unknown> = {}
  const statuses = (sp.get('status') ?? '').split(',').filter((s): s is ContainerStatus => (CONTAINER_STATUSES as readonly string[]).includes(s))
  if (statuses.length > 0) where.status = { in: statuses }
  else if (sp.get('archived') !== '1') where.status = { not: 'ARCHIVED' }
  if (sp.get('typeId')) where.typeId = sp.get('typeId')
  if (sp.get('clientId')) where.clientId = sp.get('clientId')
  if (sp.get('siteId')) where.siteId = sp.get('siteId')
  const minDays = parseInt(sp.get('minDays') ?? '', 10)
  if (Number.isFinite(minDays) && minDays > 0) {
    where.placedAt = { lte: new Date(Date.now() - minDays * 86_400_000) }
    where.status = { in: ['AT_CUSTOMER', 'FULL', 'TO_COLLECT'] }
  }
  const q = sp.get('q')?.trim()
  if (q) {
    where.OR = [
      { number: { contains: q, mode: 'insensitive' } },
      { locationLabel: { contains: q, mode: 'insensitive' } },
      { client: { name: { contains: q, mode: 'insensitive' } } },
      { site: { name: { contains: q, mode: 'insensitive' } } },
      { site: { address: { contains: q, mode: 'insensitive' } } },
    ]
  }
  const sortKey = (sp.get('sort') ?? 'number') as keyof typeof SORTS
  const orderBy = SORTS[sortKey] ?? SORTS.number
  const [rows, total] = await Promise.all([
    db.container.findMany({
      where, skip, take: limit, orderBy,
      include: {
        type:   { select: { id: true, name: true, capacityM3: true } },
        client: { select: { id: true, name: true } },
        site:   { select: { id: true, name: true, address: true } },
      },
    }),
    db.container.count({ where }),
  ])
  const now = new Date()
  const data = rows.map(c => ({ ...c, daysOnSite: ['AT_CUSTOMER', 'FULL', 'TO_COLLECT'].includes(c.status) ? daysOnSite(c.placedAt, now) : null }))
  return paged(data, total, page, limit)
})

/** Adds one bin (given number) or a batch (count, numbered after the highest existing one). */
export const POST = apiRoute({ name: '/api/containers', permission: 'manage_vehicles', schema: ContainerCreateSchema }, async ({ db, body, userId }) => {
  await assertTenantRefs(db, { typeId: body.typeId })
  let numbers: string[]
  if (body.number) {
    const exists = await db.container.findFirst({ where: { number: body.number }, select: { id: true } })
    if (exists) throw unprocessable(`Le numéro ${body.number} existe déjà`, 'DUPLICATE')
    numbers = [body.number]
  } else {
    const prefix = body.prefix ?? 'B-'
    const existing = await db.container.findMany({ where: { number: { startsWith: prefix } }, select: { number: true } })
    numbers = nextNumbers(existing.map(e => e.number), prefix, body.count ?? 1)
  }
  const created = await db.$transaction(async tx => {
    const out = []
    for (const number of numbers) {
      const c = await tx.container.create({
        data: {
          number, qrToken: newQrToken(), typeId: body.typeId, status: 'AVAILABLE',
          condition: body.condition ?? 'good', purchaseDate: body.purchaseDate ?? null, purchaseCost: body.purchaseCost ?? null,
          notes: body.notes ?? '', locationLabel: body.locationLabel ?? 'Dépôt', lastMovementAt: new Date(),
        } as Parameters<typeof tx.container.create>[0]['data'],
      })
      await tx.containerEvent.create({
        data: { containerId: c.id, type: 'CREATED', toStatus: 'AVAILABLE', userId } as Parameters<typeof tx.containerEvent.create>[0]['data'],
      })
      out.push(c)
    }
    return out
  })
  return { data: created }
})
