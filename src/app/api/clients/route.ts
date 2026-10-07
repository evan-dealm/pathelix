import { NextRequest, NextResponse } from 'next/server'
import { ClientCreateSchema } from '@/lib/crm/schemas'
import { isApiKeyRequest } from '@/lib/apiKeyAuth'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { getTenantDb } from '@/lib/tenantDb'
import { redisCache } from '@/lib/redisCache'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  const params   = req.nextUrl.searchParams
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '50', 10) || 50))

  try {
    const cacheQualifier = `p${page}_l${limit}`
    const result = await redisCache.getOrSet(
      'clients',
      tenantId,
      async () => {
        const db = getTenantDb(tenantId)
        const where = { archived: false }
        const [clients, total] = await Promise.all([
          db.client.findMany({
            where,
            select: {
              id: true, name: true, vip: true, requiresBsd: true,
              siret: true, archived: true, externalRef: true,
              contact: true, phone: true, email: true,
              clientSites: { include: { site: true } },
            },
            orderBy: { name: 'asc' },
            skip: (page - 1) * limit,
            take: limit,
          }),
          db.client.count({ where }),
        ])
        return { data: clients, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
      },
      30_000,
      cacheQualifier,
    )
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  // Admins only for interactive users; an API key gets here only with the matching write scope.
  if (role !== 'admin' && !isApiKeyRequest(userId)) return NextResponse.json({ error: 'Admin requis' }, { status: 403 })

  let rawBody: unknown
  try { rawBody = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = ClientCreateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const {
    name, contact, phone, email, vip, requiresDeposit, ecoResponsable, requiresBsd,
    voucherRequired, notes, siret, billingAddress, externalRef, sector,
    contractStart, contractEnd, paymentTermsDays, siteIds,
  } = parsed.data

  try {
    const db = getTenantDb(tenantId)

    if (siteIds && siteIds.length > 0) {
      const validSites = await db.site.count({
        where: { id: { in: siteIds } },
      })
      if (validSites !== siteIds.length) {
        return NextResponse.json({ error: 'Un ou plusieurs sites sont introuvables' }, { status: 400 })
      }
    }

    const client = await db.client.create({
      data: {
        name: name.trim(),
        contact: contact || '', phone: phone || '', email: email || '',
        vip: vip || false, requiresDeposit: requiresDeposit || false,
        ecoResponsable: ecoResponsable || false, requiresBsd: requiresBsd || false,
        voucherRequired: voucherRequired || false, notes: notes || '',
        siret: siret || '', billingAddress: billingAddress || '',
        externalRef: externalRef || '', sector: sector || '',
        contractStart: contractStart ? new Date(contractStart) : null,
        contractEnd:   contractEnd   ? new Date(contractEnd)   : null,
        paymentTermsDays: paymentTermsDays ?? 30,
        ...(siteIds && siteIds.length > 0 ? {
          clientSites: { create: siteIds.map(siteId => ({ siteId })) },
        } : {}),
      } as Parameters<typeof db.client.create>[0]['data'],
      include: { clientSites: { include: { site: true } } },
    })
    void redisCache.invalidateAll('clients', tenantId)
    return NextResponse.json(client, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
