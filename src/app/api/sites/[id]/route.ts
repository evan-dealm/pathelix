import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequestContext } from '@/lib/data/context'
import { redisCache } from '@/lib/redisCache'
import { getTenantDb } from '@/lib/tenantDb'

const SiteUpdateSchema = z.object({
  name:              z.string().min(1).max(200).optional(),
  address:           z.string().max(500).optional(),
  latitude:          z.number().min(-90).max(90).optional(),
  longitude:         z.number().min(-180).max(180).optional(),
  accessNotes:       z.string().max(2000).optional(),
  defaultManeuverMin: z.number().int().min(0).max(480).optional(),
  sector:            z.string().max(100).optional(),
  archived:          z.boolean().optional(),
  clientIds:         z.array(z.string()).optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = SiteUpdateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { clientIds, ...data } = parsed.data

  try {
    const db = getTenantDb(tenantId)
    const existing = await db.site.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })

    if (clientIds && clientIds.length > 0) {
      const validClients = await db.client.count({
        where: { id: { in: clientIds } },
      })
      if (validClients !== clientIds.length) {
        return NextResponse.json({ error: 'Un ou plusieurs clients sont introuvables' }, { status: 400 })
      }
    }

    const updated = await db.$transaction(async (tx) => {
      await tx.site.update({
        where: { id },
        data,
      })

      if (clientIds !== undefined) {
        await tx.clientSite.deleteMany({ where: { siteId: id } })
        if (clientIds.length > 0) {
          await tx.clientSite.createMany({
            data: clientIds.map(clientId => ({ clientId, siteId: id })),
            skipDuplicates: true,
          })
        }
      }

      return tx.site.findFirst({
        where: { id },
        include: { clientSites: { include: { client: { select: { id: true, name: true } } } } },
      })
    })
    void redisCache.invalidateAll('sites', tenantId)
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  const { id } = await params

  try {
    const db = getTenantDb(tenantId)
    const existing = await db.site.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
    await db.site.update({ where: { id }, data: { archived: true } })
    void redisCache.invalidateAll('sites', tenantId)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
