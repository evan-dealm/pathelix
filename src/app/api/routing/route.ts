import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { calcRoute } from '@/services/trimble'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'

const log = createLogger('/api/routing')

const OSRM_BASE = 'https://router.project-osrm.org'

async function osrmRoute(
  waypoints: [number, number][],
  signal?: AbortSignal,
): Promise<{
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  distanceKm: number
  durationMin: number
} | null> {

  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`

  try {
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'Pathelix/1.0' },
    })
    if (!res.ok) return null

    const data = await res.json()
    if (data.code !== 'Ok' || !data.routes?.[0]) return null

    const route = data.routes[0]
    return {
      geometry:    route.geometry,
      distanceKm:  Math.round((route.distance / 1000) * 100) / 100,
      durationMin: Math.round((route.duration / 60) * 10) / 10,
    }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  getRequestContext(req) // enforces auth via middleware; throws if no valid session

  const { searchParams } = req.nextUrl

  const fromStr = searchParams.get('from')
  const toStr   = searchParams.get('to')

  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: 'Paramètres requis : from=lat,lng&to=lat,lng' },
      { status: 400 },
    )
  }

  const fromParts = fromStr.split(',').map(Number)
  const toParts   = toStr.split(',').map(Number)

  if (
    fromParts.length !== 2 || toParts.length !== 2 ||
    fromParts.some(isNaN) || toParts.some(isNaN)
  ) {
    return NextResponse.json(
      { error: 'Format attendu : lat,lng (ex: 45.89,6.12)' },
      { status: 400 },
    )
  }

  const fromLat = fromParts[0] as number
  const fromLng = fromParts[1] as number
  const toLat   = toParts[0]  as number
  const toLng   = toParts[1]  as number

  const invalidCoord =
    fromLat < -90  || fromLat > 90  ||
    toLat   < -90  || toLat   > 90  ||
    fromLng < -180 || fromLng > 180 ||
    toLng   < -180 || toLng   > 180

  if (invalidCoord) {
    return NextResponse.json(
      { error: 'Coordonnees GPS hors plage' },
      { status: 400 },
    )
  }

  try {
    const result = await calcRoute({
      origin:      { lat: fromLat, lng: fromLng },
      destination: { lat: toLat,   lng: toLng   },
    })
    return NextResponse.json(result)
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  getRequestContext(req) // enforces auth via middleware; throws if no valid session

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const CoordPairSchema = z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  const LatLngSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  const RoutingPostSchema = z.union([
    z.object({ waypoints: z.array(CoordPairSchema).min(2) }),
    z.object({ from: LatLngSchema, to: LatLngSchema }),
  ])

  const validation = RoutingPostSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { error: 'Champs requis : waypoints: [[lng,lat],...] ou from/to: {lat,lng}' },
      { status: 400 },
    )
  }

  const parsed = validation.data

  if ('waypoints' in parsed) {
    const wps = parsed.waypoints as [number, number][]
    try {
      const result = await osrmRoute(wps)
      if (result) {
        return NextResponse.json(result)
      }

      return NextResponse.json({ geometry: null, distanceKm: 0, durationMin: 0 })
    } catch (err) {
      log.error('POST waypoints failed', { err: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ geometry: null, distanceKm: 0, durationMin: 0 })
    }
  }

  const { from, to } = parsed

  try {
    const result = await calcRoute({ origin: from, destination: to })
    return NextResponse.json(result)
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
