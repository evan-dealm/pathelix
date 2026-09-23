import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { redisCache } from '@/lib/redisCache'
import { getTenantDb } from '@/lib/tenantDb'

const SiteCreateSchema = z.object({
  name:               z.string().min(1).max(200),
  address:            z.string().max(500).optional(),
  latitude:           z.number().min(-90).max(90).optional(),
  longitude:          z.number().min(-180).max(180).optional(),
  accessNotes:        z.string().max(2000).optional(),
  defaultManeuverMin: z.number().int().min(0).max(120).optional(),
  sector:             z.string().max(100).optional(),

  city:               z.string().max(100).optional(),
  zipCode:            z.string().max(20).optional(),
  country:            z.string().max(10).optional(),
  siteType:           z.enum(['chantier', 'entrepot', 'usine', 'bureau', 'autre', '']).optional(),

  openingHoursOpen:   z.number().int().min(0).max(1439).optional().nullable(),
  openingHoursClose:  z.number().int().min(0).max(1439).optional().nullable(),
  clientIds:          z.array(z.string().max(100)).max(100).optional(),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  const params   = req.nextUrl.searchParams
  const clientId = params.get('clientId')
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '50', 10) || 50))

  try {
    const db = getTenantDb(tenantId)
    const where: Record<string, unknown> = { archived: false }

    if (clientId) {
      const [client, links] = await Promise.all([
        db.client.findFirst({ where: { id: clientId }, select: { id: true } }),
        db.clientSite.findMany({ where: { clientId, site: { tenantId } }, select: { siteId: true } }),
      ])
      if (!client) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })
      where.id = { in: links.map(l => l.siteId) }
    }

    const qualifier = clientId ? `c${clientId}_p${page}` : `p${page}_l${limit}`
    const result = await redisCache.getOrSet(
      'sites',
      tenantId,
      async () => {
        const [sites, total] = await Promise.all([
          db.site.findMany({
            where,
            include: { clientSites: { include: { client: { select: { id: true, name: true } } } } },
            orderBy: { name: 'asc' },
            skip: (page - 1) * limit,
            take: limit,
          }),
          db.site.count({ where }),
        ])
        return { data: sites, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
      },
      30_000,
      qualifier,
    )
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=60' },
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

  const parsed = SiteCreateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const {
    name, address, latitude, longitude, accessNotes, defaultManeuverMin, sector,
    city, zipCode, country, siteType, openingHoursOpen, openingHoursClose, clientIds,
  } = parsed.data

  try {
    const db = getTenantDb(tenantId)

    if (clientIds && clientIds.length > 0) {
      const validClients = await db.client.count({
        where: { id: { in: clientIds } },
      })
      if (validClients !== clientIds.length) {
        return NextResponse.json({ error: 'Un ou plusieurs clients sont introuvables' }, { status: 400 })
      }
    }

    const site = await db.site.create({
      data: {
        name: name.trim(),
        address: address || '', latitude: latitude || 0, longitude: longitude || 0,
        accessNotes: accessNotes || '', defaultManeuverMin: defaultManeuverMin ?? 15,
        sector: sector || '',
        city: city || '', zipCode: zipCode || '', country: country || 'FR',
        siteType: siteType || '',
        openingHoursOpen:  openingHoursOpen  ?? null,
        openingHoursClose: openingHoursClose ?? null,
        ...(clientIds && clientIds.length > 0 ? {
          clientSites: { create: clientIds.map(clientId => ({ clientId })) },
        } : {}),
      } as Parameters<typeof db.site.create>[0]['data'],
      include: { clientSites: { include: { client: { select: { id: true, name: true } } } } },
    })
    void redisCache.invalidateAll('sites', tenantId)
    return NextResponse.json(site, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
