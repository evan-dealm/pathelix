import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import prisma from '@/lib/db'
import { redisCache } from '@/lib/redisCache'

const ClientCreateSchema = z.object({
  name:             z.string().min(1).max(200),
  contact:          z.string().max(200).optional(),
  phone:            z.string().max(50).optional(),
  email:            z.string().max(200).optional(),
  vip:              z.boolean().optional(),
  requiresDeposit:  z.boolean().optional(),
  ecoResponsable:   z.boolean().optional(),
  requiresBsd:      z.boolean().optional(),
  voucherRequired:  z.boolean().optional(),
  notes:            z.string().max(2000).optional(),

  siret:            z.string().max(100).optional(),
  billingAddress:   z.string().max(500).optional(),
  externalRef:      z.string().max(200).optional(),
  sector:           z.string().max(100).optional(),
  contractStart:    z.string().datetime({ offset: true }).optional().nullable(),
  contractEnd:      z.string().datetime({ offset: true }).optional().nullable(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  siteIds:          z.array(z.string().max(100)).max(100).optional(),
})

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
        const where = { tenantId, archived: false }
        const [clients, total] = await Promise.all([
          prisma.client.findMany({
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
          prisma.client.count({ where }),
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
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })

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

    if (siteIds && siteIds.length > 0) {
      const validSites = await prisma.site.count({
        where: { id: { in: siteIds }, tenantId },
      })
      if (validSites !== siteIds.length) {
        return NextResponse.json({ error: 'Un ou plusieurs sites sont introuvables' }, { status: 400 })
      }
    }

    const client = await prisma.client.create({
      data: {
        tenantId, name: name.trim(),
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
      },
      include: { clientSites: { include: { site: true } } },
    })
    void redisCache.invalidateAll('clients', tenantId)
    return NextResponse.json(client, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
