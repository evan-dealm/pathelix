import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequestContext } from '@/lib/data/context'
import prisma from '@/lib/db'
import { redisCache } from '@/lib/redisCache'

const UpdateSiteProductSchema = z.object({
  siteId:             z.string().min(1).optional(),
  clientId:           z.string().min(1).optional(),
  wasteType:          z.string().max(100).optional(),
  binSizeLabel:       z.string().max(50).optional(),
  binSizeM3:          z.number().positive().optional(),
  equipmentType:      z.string().max(100).optional(),
  defaultDurationMin: z.number().int().positive().optional(),
  defaultExutoireId:  z.string().min(1).nullable().optional(),
  notes:              z.string().max(2000).optional(),
  archived:           z.boolean().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  const { id } = await params

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = UpdateSiteProductSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    const existing = await prisma.siteProduct.findFirst({ where: { id, tenantId } })
    if (!existing) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })

    const data = parsed.data as Record<string, unknown>
    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Aucun champ modifiable' }, { status: 400 })

    const updated = await prisma.siteProduct.updateMany({
      where: { id, tenantId },
      data,
    })
    if (updated.count === 0) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })

    void redisCache.invalidate('site-products', tenantId)
    const product = await prisma.siteProduct.findFirst({
      where: { id, tenantId },
      include: {
        site:            { select: { id: true, name: true } },
        client:          { select: { id: true, name: true } },
        defaultExutoire: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json(product)
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  const { id } = await params

  try {

    const deleted = await prisma.siteProduct.updateMany({ where: { id, tenantId }, data: { archived: true } })
    if (deleted.count === 0) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })
    void redisCache.invalidate('site-products', tenantId)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
