import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { getTenantDb } from '@/lib/tenantDb'
import { redisCache } from '@/lib/redisCache'

const SiteProductCreateSchema = z.object({
  siteId:             z.string().min(1).max(100),
  clientId:           z.string().min(1).max(100),
  wasteType:          z.string().min(1).max(200),
  binSizeLabel:       z.string().max(100).optional(),
  binSizeM3:          z.number().min(0).max(200).nullish(),
  equipmentType:      z.string().max(100).optional(),
  defaultDurationMin: z.number().int().min(0).max(480).optional(),
  defaultExutoireId:  z.string().max(100).nullish(),
  notes:              z.string().max(2000).optional(),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  const siteId   = req.nextUrl.searchParams.get('siteId')
  const clientId = req.nextUrl.searchParams.get('clientId')

  try {
    const qualifier = siteId ? `s:${siteId}` : clientId ? `c:${clientId}` : 'all'
    const products = await redisCache.getOrSet(
      'site-products' as never,
      tenantId,
      async () => {
        const where: Record<string, unknown> = { archived: false }
        if (siteId)   where.siteId   = siteId
        if (clientId) where.clientId = clientId

        return getTenantDb(tenantId).siteProduct.findMany({
          where,
          include: {
            site:            { select: { id: true, name: true, address: true, latitude: true, longitude: true, accessNotes: true, defaultManeuverMin: true } },
            client:          { select: { id: true, name: true, vip: true, requiresBsd: true, voucherRequired: true } },
            defaultExutoire: { select: { id: true, name: true } },
          },
          orderBy: [{ client: { name: 'asc' } }, { wasteType: 'asc' }],
          take: 2000,
        })
      },
      30_000,
      qualifier,
    )
    return NextResponse.json(products, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })

  let rawBody: unknown
  try { rawBody = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = SiteProductCreateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { siteId, clientId, wasteType, binSizeLabel, binSizeM3, equipmentType, defaultDurationMin, defaultExutoireId, notes } = parsed.data

  try {
    const db = getTenantDb(tenantId)

    const [client, site] = await Promise.all([
      db.client.findFirst({ where: { id: clientId }, select: { id: true } }),
      db.site.findFirst({ where: { id: siteId }, select: { id: true } }),
    ])
    if (!client) return NextResponse.json({ error: 'Client introuvable pour ce tenant' }, { status: 404 })
    if (!site) return NextResponse.json({ error: 'Site introuvable pour ce tenant' }, { status: 404 })

    await db.clientSite.upsert({
      where: { clientId_siteId: { clientId, siteId } },
      update: {},
      create: { clientId, siteId },
    })

    const product = await db.siteProduct.create({
      data: {
        siteId, clientId,
        wasteType: wasteType.trim(),
        binSizeLabel: binSizeLabel || '',
        binSizeM3: binSizeM3 ?? null,
        equipmentType: equipmentType || '',
        defaultDurationMin: defaultDurationMin ?? 30,
        defaultExutoireId: defaultExutoireId || null,
        notes: notes || '',
      } as Parameters<typeof db.siteProduct.create>[0]['data'],
      include: {
        site:            { select: { id: true, name: true } },
        client:          { select: { id: true, name: true } },
        defaultExutoire: { select: { id: true, name: true } },
      },
    })
    void redisCache.invalidateAll('site-products' as never, tenantId)
    return NextResponse.json(product, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
