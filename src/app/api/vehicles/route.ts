import { NextRequest, NextResponse } from 'next/server'
import { VehicleSchema }             from '@/lib/schemas'
import { createLogger }              from '@/lib/logger'
import { getTenantId, getRequestContext } from '@/lib/data/context'
import { metrics, METRIC }           from '@/lib/metrics'
import { redisCache }                from '@/lib/redisCache'
import { getVehicleStore }           from './_store'
import prisma                        from '@/lib/db'
import { auditAsync }                from '@/lib/audit'
import { hasPermission }             from '@/lib/permissions'

const log    = createLogger('/api/vehicles')
const useMock = process.env.USE_MOCK_DATA !== 'false'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0       = Date.now()
  const tenantId = getTenantId(req)
  const params   = req.nextUrl.searchParams
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '50', 10) || 50))

  if (useMock) {
    const store = getVehicleStore()
    const items = store.filter(v => v.tenantId === tenantId && !v.archived)
    const start = (page - 1) * limit
    const paged = items.slice(start, start + limit)
    return NextResponse.json({ data: paged, pagination: { page, limit, total: items.length, pages: Math.ceil(items.length / limit) } })
  }

  try {
    const qualifier = `p${page}_l${limit}`
    const result = await redisCache.getOrSet(
      'vehicles',
      tenantId,
      async () => {
        const where = { tenantId }
        const [vehicles, total] = await Promise.all([
          prisma.vehicle.findMany({
            where,
            select: {
              id: true, licensePlate: true, gabaritProfile: true,
              weightTon: true, heightM: true, widthM: true, lengthM: true,
              axleCount: true, hazmat: true, archived: true,
              gpsDeviceId: true, assignedDriverId: true,
              type: true, brand: true, model: true, capacityM3: true, maxBins: true,
              mileageKm: true, nextInspection: true, status: true, notes: true,
              fuelType: true, year: true, vin: true, color: true,
              insuranceExpiry: true, insuranceRef: true, lastServiceDate: true, lastServiceKm: true,
              tollClass: true, telepayBadge: true, telepayDiscount: true,
            },
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
          }),
          prisma.vehicle.count({ where }),
        ])
        return { data: vehicles, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
      },
      60_000,
      qualifier,
    )

    metrics.histogram(METRIC.API_LATENCY_MS, Date.now() - t0, { route: '/api/vehicles', method: 'GET' })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/vehicles', method: 'GET', status: '200' })

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/vehicles', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }
  if (!(await hasPermission(userId, role, 'manage_vehicles'))) {
    return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = VehicleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  if (useMock) {
    const store = getVehicleStore()
    const { assignedDriverId, ...rest } = parsed.data as Record<string, unknown> & { assignedDriverId?: string }
    const vehicle = {
      id: crypto.randomUUID(),
      tenantId,
      brand: '', model: '', mileageKm: 0, status: 'active', notes: '',
      weightTon: 26, heightM: 4.0, widthM: 2.55, lengthM: 12.0, axleCount: 3, hazmat: false,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...rest,
      assignedDriverId: assignedDriverId ?? null,
    }
    store.push(vehicle as typeof store[number])
    return NextResponse.json(vehicle, { status: 201 })
  }

  try {
    const { assignedDriverId, ...rest } = parsed.data as Record<string, unknown> & { assignedDriverId?: string }
    const createData: Record<string, unknown> = { tenantId, ...rest }
    if (assignedDriverId) {
      createData.assignedDriverId = assignedDriverId
    }

    const vehicle  = await prisma.vehicle.create({
      data: createData as Parameters<typeof prisma.vehicle.create>[0]['data'],
    })

    void redisCache.invalidateAll('vehicles', tenantId)
    auditAsync(req, 'vehicle.create', 'Vehicle', vehicle.id, { plate: (vehicle as { plate?: string }).plate ?? '' })
    metrics.increment(METRIC.API_REQUESTS, { route: '/api/vehicles', method: 'POST', status: '201' })
    return NextResponse.json(vehicle, { status: 201 })
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Un véhicule avec cette immatriculation existe déjà' }, { status: 409 })
    }
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    metrics.increment(METRIC.API_ERRORS, { route: '/api/vehicles', type: 'server_error' })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
