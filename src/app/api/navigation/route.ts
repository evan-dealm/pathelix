import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import prisma from '@/lib/db'

const log = createLogger('/api/navigation')

const RouteRequestSchema = z.object({
  origin:      z.object({ lat: z.number(), lng: z.number() }),
  destination: z.object({ lat: z.number(), lng: z.number() }),
  vehicleId:   z.string().optional(),

  waypoints:   z.array(z.object({ lat: z.number(), lng: z.number() })).optional(),
})

const MatchRequestSchema = z.object({
  positions: z.array(z.object({
    lat: z.number(),
    lng: z.number(),
    time: z.number().optional(),
  })).min(2).max(100),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const valhallaUrl = process.env.VALHALLA_URL ?? ''
  if (!valhallaUrl) {
    return NextResponse.json({ error: 'Service de navigation non configuré (VALHALLA_URL manquant)' }, { status: 503 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const action = req.nextUrl.searchParams.get('action') ?? 'route'

  if (action === 'match') {
    return handleMatch(body, valhallaUrl)
  }

  const parsed = RouteRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { origin, destination, vehicleId, waypoints } = parsed.data

  try {

    let costingOptions: Record<string, unknown> = {
      truck: { weight: 26, height: 4.0, width: 2.55, length: 12.0 },
    }

    if (vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: vehicleId, tenantId: session.tenantId },
        select: { weightTon: true, heightM: true, widthM: true, lengthM: true, axleCount: true, hazmat: true },
      })
      if (vehicle) {
        costingOptions = {
          truck: {
            weight:     vehicle.weightTon,
            height:     vehicle.heightM,
            width:      vehicle.widthM,
            length:     vehicle.lengthM,
            axle_count: vehicle.axleCount,
            hazmat:     vehicle.hazmat,
            use_highways: 0.8,
            use_tolls:    0.5,
          },
        }
      }
    }

    const locations = [
      { lat: origin.lat, lon: origin.lng, type: 'break' },
      ...(waypoints ?? []).map(w => ({ lat: w.lat, lon: w.lng, type: 'through' as const })),
      { lat: destination.lat, lon: destination.lng, type: 'break' },
    ]

    const valhallaBody = {
      locations,
      costing: 'truck',
      costing_options: costingOptions,
      directions_options: {
        units: 'kilometers',
        language: 'fr-FR',
      },
      date_time: { type: 0, value: 'current' },
    }

    const res = await fetch(`${valhallaUrl}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valhallaBody),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      log.warn('Valhalla route failed', { status: res.status, err: err.slice(0, 200) })
      return NextResponse.json({ error: 'Calcul d\'itinéraire impossible' }, { status: 502 })
    }

    const data = await res.json() as {
      trip: {
        legs: Array<{
          shape: string
          summary: { length: number; time: number }
          maneuvers: Array<{
            type: number
            instruction: string
            length: number
            time: number
            begin_shape_index: number
            end_shape_index: number
            street_names?: string[]
            verbal_pre_transition_instruction?: string
          }>
        }>
        summary: { length: number; time: number }
      }
    }

    const legs = data.trip.legs.map(leg => ({
      geometry: decodePolyline(leg.shape),
      distanceKm: Math.round(leg.summary.length * 10) / 10,
      durationMin: Math.round(leg.summary.time / 60),
      maneuvers: leg.maneuvers.map(m => ({
        type: m.type,
        instruction: m.instruction,
        verbalInstruction: m.verbal_pre_transition_instruction,
        distanceKm: Math.round(m.length * 100) / 100,
        durationSec: m.time,
        shapeIndex: m.begin_shape_index,
        streetNames: m.street_names,
      })),
    }))

    return NextResponse.json({
      legs,
      totalDistanceKm: Math.round(data.trip.summary.length * 10) / 10,
      totalDurationMin: Math.round(data.trip.summary.time / 60),
      etaTimestamp: Date.now() + data.trip.summary.time * 1000,
    })
  } catch (err) {
    log.error('Navigation route failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

async function handleMatch(body: unknown, valhallaUrl: string): Promise<NextResponse> {
  const parsed = MatchRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    const shape = parsed.data.positions.map(p => ({
      lat: p.lat, lon: p.lng, time: p.time,
    }))

    const res = await fetch(`${valhallaUrl}/trace_route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shape,
        costing: 'truck',
        shape_match: 'map_snap',
      }),
      signal: AbortSignal.timeout(5_000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Map matching échoué' }, { status: 502 })
    }

    const data = await res.json() as {
      matched_points: Array<{ lat: number; lon: number; edge_index: number }>
      shape: string
    }

    return NextResponse.json({
      matchedPoints: data.matched_points?.map(p => ({ lat: p.lat, lng: p.lon })) ?? [],
      geometry: data.shape ? decodePolyline(data.shape) : null,
    })
  } catch (err) {
    log.error('Map matching failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

function decodePolyline(encoded: string, precision = 6): Array<[number, number]> {
  const coords: Array<[number, number]> = []
  let index = 0, lat = 0, lng = 0
  const factor = Math.pow(10, precision)

  while (index < encoded.length) {
    let b: number, shift = 0, result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)

    shift = 0; result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)

    coords.push([lng / factor, lat / factor])
  }

  return coords
}
