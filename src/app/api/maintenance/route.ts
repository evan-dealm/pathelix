import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { redisCache } from '@/lib/redisCache'

const log = createLogger('/api/maintenance')

const MAINT_SELECT = {
  id:          true,
  vehicleId:   true,
  type:        true,
  description: true,
  costEur:     true,
  mileageKm:   true,
  doneAt:      true,
  doneBy:      true,
  notes:       true,
  createdAt:   true,
} as const

const MaintenanceSchema = z.object({
  vehicleId:   z.string().min(1),
  type:        z.enum(['inspection', 'oil_change', 'repair', 'tire', 'other']),
  description: z.string().max(1000).default(''),
  costEur:     z.number().min(0).optional().nullable(),
  mileageKm:   z.number().int().min(0).optional().nullable(),
  doneAt:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  doneBy:      z.string().max(200).default(''),
  notes:       z.string().max(2000).default(''),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId  = getTenantId(req)
  const vehicleId = req.nextUrl.searchParams.get('vehicleId') ?? undefined
  const limit     = Math.min(parseInt(req.nextUrl.searchParams.get('limit')  ?? '50', 10), 100)
  const offset    = Math.max(parseInt(req.nextUrl.searchParams.get('offset') ?? '0',   10), 0)
  const qualifier = vehicleId ?? 'all'

  try {
    const records = await redisCache.getOrSet(
      'maintenance',
      tenantId,
      () => prisma.maintenanceRecord.findMany({
        where:   { tenantId, ...(vehicleId ? { vehicleId } : {}) },
        orderBy: { doneAt: 'desc' },
        take:    limit,
        skip:    offset,
        select:  MAINT_SELECT,
      }),
      30_000,
      `${qualifier}:${limit}:${offset}`,
    )
    return NextResponse.json(records, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin') return NextResponse.json({ error: 'Admin requis' }, { status: 403 })

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = MaintenanceSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    const vehicle = await prisma.vehicle.findFirst({
      where:  { id: parsed.data.vehicleId, tenantId },
      select: { id: true },
    })
    if (!vehicle) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })

    const record = await prisma.maintenanceRecord.create({
      data:   { tenantId, ...parsed.data },
      select: MAINT_SELECT,
    })
    void redisCache.invalidateAll('maintenance', tenantId)
    return NextResponse.json(record, { status: 201 })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
