import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import prisma from '@/lib/db'
import { redisCache } from '@/lib/redisCache'

const ClientUpdateSchema = z.object({
  name:             z.string().min(1).max(200).optional(),
  contact:          z.string().max(200).optional(),
  phone:            z.string().max(50).optional(),
  email:            z.string().max(200).optional(),
  vip:              z.boolean().optional(),
  requiresDeposit:  z.boolean().optional(),
  ecoResponsable:   z.boolean().optional(),
  requiresBsd:      z.boolean().optional(),
  voucherRequired:  z.boolean().optional(),
  notes:            z.string().max(2000).optional(),
  archived:         z.boolean().optional(),

  siret:            z.string().max(100).optional(),
  billingAddress:   z.string().max(500).optional(),
  externalRef:      z.string().max(200).optional(),
  sector:           z.string().max(100).optional(),
  contractStart:    z.string().datetime({ offset: true }).optional().nullable(),
  contractEnd:      z.string().datetime({ offset: true }).optional().nullable(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  siteIds:          z.array(z.string().max(100)).max(100).optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  const { id } = await params
  try {
    const client = await prisma.client.findFirst({
      where: { id, tenantId },
      include: { clientSites: { include: { site: true } }, siteProducts: true },
    })
    if (!client) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })
    return NextResponse.json(client)
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
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
    const existing = await prisma.client.findFirst({ where: { id, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

    const updated = await prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id, tenantId },
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
        where: { id, tenantId },
        include: { clientSites: { include: { site: true } } },
      })
    })
    void redisCache.invalidateAll('clients', tenantId)
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

    const existing = await prisma.client.findFirst({ where: { id, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })
    await prisma.client.update({ where: { id, tenantId }, data: { archived: true } })
    void redisCache.invalidateAll('clients', tenantId)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
