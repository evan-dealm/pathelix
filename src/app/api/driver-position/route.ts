import { NextRequest, NextResponse } from 'next/server'
import { latestPositions, speedHistory, type SpeedPoint } from '@/lib/positions'
import { getDriver } from '@/lib/data/drivers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getTenantDb } from '@/lib/tenantDb'
import { persistDriverPositions } from '@/lib/driverPositionPersist'

const _driverIdCache = new Map<string, { ids: Set<string>; expiresAt: number }>()
const DRIVER_ID_CACHE_TTL_MS = 60_000
/** A position older than this is not "live" any more. */
const POSITION_MAX_AGE_MS = 12 * 3600_000

async function getTenantDriverIds(tenantId: string): Promise<Set<string>> {
  const now    = Date.now()
  const cached = _driverIdCache.get(tenantId)
  if (cached && now < cached.expiresAt) return cached.ids
  const rows = await getTenantDb(tenantId).driver.findMany({ select: { id: true } })
  const ids  = new Set(rows.map((r: { id: string }) => r.id))
  _driverIdCache.set(tenantId, { ids, expiresAt: now + DRIVER_ID_CACHE_TTL_MS })
  return ids
}

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

  // Read from the database every GPS source writes to — any instance sees every position.
  const since = new Date(Date.now() - POSITION_MAX_AGE_MS)
  // The live map polls every 15 s and only draws positions: `history=0` skips the day's speeds.
  const withHistory = searchParams.get('history') !== '0'
  const timeZoneOf = async () => {
    const settings = await getTenantDb(tenantHeader).tenantSettings.findUnique({ where: { tenantId: tenantHeader }, select: { timezone: true } })
    return settings?.timezone || 'Europe/Paris'
  }
  if (driverId) {

    const driver = await getDriver(tenantHeader, driverId)
    if (!driver) {
      return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    }
    const [positions, history] = await Promise.all([
      latestPositions(tenantHeader, { since, driverIds: [driverId] }),
      withHistory ? speedHistory(tenantHeader, date, await timeZoneOf(), [driverId]) : Promise.resolve({} as Record<string, SpeedPoint[]>),
    ])
    return NextResponse.json({ positions, history: { [driverId]: history[driverId] ?? [] } })
  }

  const [positions, history] = await Promise.all([
    latestPositions(tenantHeader, { since }),
    withHistory ? speedHistory(tenantHeader, date, await timeZoneOf()) : Promise.resolve({} as Record<string, SpeedPoint[]>),
  ])
  return NextResponse.json({ positions, history })
}

import { z } from 'zod'
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

  // Use cached ID set (60s TTL) — avoids 1 DB query per position update
  const knownIds = await getTenantDriverIds(session.tenantId)
  if (!knownIds.has(driverId)) {
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
  await persistDriverPositions(session.tenantId, [{ driverId, lat: latitude, lng: longitude, speedKmh, timestamp: ts }])

  void emitEvent(session.tenantId, 'driver.position', {
    driverId, latitude, longitude, speedKmh: speedKmh ?? 0,
  })

  return NextResponse.json({ ok: true })
}
