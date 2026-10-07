import { NextRequest, NextResponse } from 'next/server'
import { auditAsync } from '@/lib/audit'
import { ClientUpdateSchema } from '@/lib/crm/schemas'
import { isApiKeyRequest } from '@/lib/apiKeyAuth'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { getTenantDb } from '@/lib/tenantDb'
import { redisCache } from '@/lib/redisCache'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  const { id } = await params
  try {
    const client = await getTenantDb(tenantId).client.findFirst({
      where: { id },
      include: { clientSites: { include: { site: true } }, siteProducts: true },
    })
    if (!client) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })
    return NextResponse.json(client)
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  // Admins only for interactive users; an API key gets here only with the matching write scope.
  if (role !== 'admin' && !isApiKeyRequest(userId)) return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  const { id } = await params

  let rawBody: unknown
  try { rawBody = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = ClientUpdateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { siteIds, contractStart, contractEnd, ...rest } = parsed.data
  const data = {
    ...rest,
    ...(contractStart !== undefined ? { contractStart: contractStart ? new Date(contractStart) : null } : {}),
    ...(contractEnd   !== undefined ? { contractEnd:   contractEnd   ? new Date(contractEnd)   : null } : {}),
  }

  try {
    const db = getTenantDb(tenantId)
    const existing = await db.client.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

    if (siteIds !== undefined && siteIds.length > 0) {
      const validSites = await db.site.count({
        where: { id: { in: siteIds } },
      })
      if (validSites !== siteIds.length) {
        return NextResponse.json({ error: 'Un ou plusieurs sites sont introuvables' }, { status: 400 })
      }
    }

    const updated = await db.$transaction(async (tx) => {
      await tx.client.update({
        where: { id },
        data,
      })

      if (siteIds !== undefined) {
        await tx.clientSite.deleteMany({ where: { clientId: id } })
        if (siteIds.length > 0) {
          await tx.clientSite.createMany({
            data: siteIds.map(siteId => ({ clientId: id, siteId })),
            skipDuplicates: true,
          })
        }
      }

      return tx.client.findFirst({
        where: { id },
        include: { clientSites: { include: { site: true } } },
      })
    })
    void redisCache.invalidateAll('clients', tenantId)
    auditAsync(req, 'client.update', 'Client', id, { fields: Object.keys(parsed.data) })
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  // Admins only for interactive users; an API key gets here only with the matching write scope.
  if (role !== 'admin' && !isApiKeyRequest(userId)) return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  const { id } = await params

  try {
    const db = getTenantDb(tenantId)
    const existing = await db.client.findFirst({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })
    await db.client.update({ where: { id }, data: { archived: true } })
    void redisCache.invalidateAll('clients', tenantId)
    auditAsync(req, 'client.delete', 'Client', id, {})
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
