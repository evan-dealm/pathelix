import { NextRequest, NextResponse } from 'next/server'
import {
  getAllCurrentPositions,
  getSpeedHistoryForDate,
  getAllSpeedHistories,
} from '@/lib/obdStore'
import { getDriver } from '@/lib/data/drivers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

export async function GET(req: NextRequest): Promise<NextResponse> {

  const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null

  if (!session) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  const tenantHeader = session.tenantId
  const role         = session.role
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Accès réservé aux admins et dispatchers' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const date     = searchParams.get('date')
  const driverId = searchParams.get('driverId')

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Paramètre date requis (YYYY-MM-DD)' }, { status: 400 })
  }

  if (driverId) {

    const driver = await getDriver(tenantHeader, driverId)
    if (!driver) {
      return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    }
    const positions = getAllCurrentPositions().filter(p => p.driverId === driverId)
    const history   = getSpeedHistoryForDate(driverId, date)
    return NextResponse.json({ positions, history: { [driverId]: history } })
  }

  const allPositions = getAllCurrentPositions()
  const tenantDriverIds = new Set<string>()

  const tenantDrivers = await (await import('@/lib/db')).default.driver.findMany({
    where: { tenantId: tenantHeader },
    select: { id: true },
  })
  for (const d of tenantDrivers) tenantDriverIds.add(d.id)

  const positions = allPositions.filter(p => tenantDriverIds.has(p.driverId))
  const allHistory = getAllSpeedHistories(date)
  const history: Record<string, unknown> = {}
  for (const [dId, h] of Object.entries(allHistory)) {
    if (tenantDriverIds.has(dId)) history[dId] = h
  }

  return NextResponse.json({ positions, history })
}

import { z } from 'zod'
import { recordOBDReading } from '@/lib/obdStore'
import { emitEvent } from '@/lib/integrationEvents'

const PositionSchema = z.object({
  driverId:  z.string().min(1),
  latitude:  z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKmh:  z.number().min(0).max(200).optional(),
  timestamp: z.string().optional(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null

  if (!session) {
    return NextResponse.json({ error: 'Non authentifie' }, { status: 401 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = PositionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { driverId, latitude, longitude, speedKmh, timestamp } = parsed.data

  const driver = await getDriver(session.tenantId, driverId)
  if (!driver) {
    return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
  }

  const isOwnDriver = session.driverRef === driverId || session.sub === driverId
  const isAdminOrDispatcher = session.role === 'admin' || session.role === 'dispatcher' || session.role === 'superadmin'
  if (!isOwnDriver && !isAdminOrDispatcher) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const ts = timestamp ? new Date(timestamp).getTime() : Date.now()
  if (isNaN(ts)) {
    return NextResponse.json({ error: 'Timestamp invalide' }, { status: 400 })
  }
  recordOBDReading({
    driverId,
    timestamp: ts,
    lat: latitude,
    lng: longitude,
    speedKmh: speedKmh ?? 0,
    ignition: true,
  })

  void emitEvent(session.tenantId, 'driver.position', {
    driverId, latitude, longitude, speedKmh: speedKmh ?? 0,
  })

  return NextResponse.json({ ok: true })
}
