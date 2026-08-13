import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { redisCache } from '@/lib/redisCache'

const log = createLogger('/api/fuel-records')

const FUEL_SELECT = {
  id:            true,
  vehicleId:     true,
  driverId:      true,
  liters:        true,
  costEur:       true,
  pricePerLiter: true,
  mileageKm:     true,
  stationName:   true,
  filledAt:      true,
  fullTank:      true,
  notes:         true,
  createdAt:     true,
} as const

const FuelSchema = z.object({
  vehicleId:     z.string().min(1),
  driverId:      z.string().optional().nullable(),
  liters:        z.number().min(0),
  costEur:       z.number().min(0),
  pricePerLiter: z.number().min(0).optional().nullable(),
  mileageKm:     z.number().int().min(0).default(0),
  stationName:   z.string().max(200).default(''),
  filledAt:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fullTank:      z.boolean().default(true),
  notes:         z.string().max(1000).default(''),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId  = getTenantId(req)
  const vehicleId = req.nextUrl.searchParams.get('vehicleId') ?? undefined
  const limit     = Math.min(parseInt(req.nextUrl.searchParams.get('limit')  ?? '50', 10) || 50, 100)
  const offset    = Math.max(parseInt(req.nextUrl.searchParams.get('offset') ?? '0',   10) || 0,   0)
  const qualifier = vehicleId ?? 'all'

  try {
    const records = await redisCache.getOrSet(
      'fuel-records',
      tenantId,
      () => prisma.fuelRecord.findMany({
        where:   { tenantId, ...(vehicleId ? { vehicleId } : {}) },
        orderBy: { filledAt: 'desc' },
        take:    limit,
        skip:    offset,
        select:  FUEL_SELECT,
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
  if (role !== 'admin' && role !== 'dispatcher') return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = FuelSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    const vehicle = await prisma.vehicle.findFirst({
      where:  { id: parsed.data.vehicleId, tenantId },
      select: { id: true },
    })
    if (!vehicle) return NextResponse.json({ error: 'Véhicule introuvable' }, { status: 404 })

    // FuelRecord.driverId has no DB-level FK (see AUDIT_BUGS.md N19) — same pattern as
    // DeliveryProof: must be checked against tenantId here or a record could reference a
    // driver belonging to a different tenant.
    if (parsed.data.driverId) {
      const driver = await prisma.driver.findFirst({
        where:  { id: parsed.data.driverId, tenantId },
        select: { id: true },
      })
      if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    }

    const record = await prisma.fuelRecord.create({
      data:   { tenantId, ...parsed.data },
      select: FUEL_SELECT,
    })
    void redisCache.invalidateAll('fuel-records', tenantId)
    return NextResponse.json(record, { status: 201 })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
