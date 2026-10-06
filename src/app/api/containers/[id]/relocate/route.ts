import { apiRoute, unprocessable } from '@/lib/api/route'
import { ContainerRelocateSchema } from '@/lib/containers/schemas'
import { relocate } from '@/lib/containers/service'
import { assertTenantRefs } from '@/lib/tenantRefs'

/**
 * Corrects where a bin is — at a customer's site (initial inventory, a bin found on site) or back
 * at the depot. Logged with who did it.
 */
export const POST = apiRoute({ name: '/api/containers/[id]/relocate', permission: 'manage_vehicles', schema: ContainerRelocateSchema }, async ({ db, body, params, userId }) => {
  await assertTenantRefs(db, { clientId: body.clientId ?? undefined, siteId: body.siteId ?? undefined })
  let latitude: number | null = null
  let longitude: number | null = null
  let clientId = body.clientId ?? null
  if (body.siteId) {
    const site = await db.site.findFirst({
      where: { id: body.siteId },
      select: { latitude: true, longitude: true, clientSites: { select: { clientId: true }, take: 2 } },
    })
    if (!site) throw unprocessable('Site introuvable', 'FOREIGN_REF')
    latitude = site.latitude || null
    longitude = site.longitude || null
    // A site with a single client: the bin is at that client's.
    if (!clientId && site.clientSites.length === 1) clientId = site.clientSites[0].clientId
  }
  await db.$transaction(tx => relocate(tx, params.id, {
    clientId, siteId: body.siteId ?? null, latitude, longitude, locationLabel: body.locationLabel,
    placedAt: body.placedAt ? new Date(`${body.placedAt}T12:00:00`) : null,
  }, userId, body.notes ?? ''))
  return { ok: true }
})
