import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { calcTrimbleRoute, calcRoute } from '@/services/trimble'
import type { TrimbleRouteRequest } from '@/services/trimble'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'

const log = createLogger('/api/trimble/route-calc')

const PointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

const RouteCalcSchema = z.object({
  origin: PointSchema,
  destination: PointSchema,
  waypoints: z.array(PointSchema).optional(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  getRequestContext(req) // enforces auth via middleware; throws if no valid session

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const parsed = RouteCalcSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Champs requis : origin: {lat,lng}, destination: {lat,lng}', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const routeReq: TrimbleRouteRequest = parsed.data

  try {

    const trimble = await calcTrimbleRoute(routeReq)
    if (trimble) {
      return NextResponse.json({ ...trimble, source: 'trimble' })
    }

    const fallback = await calcRoute(routeReq)
    return NextResponse.json({ ...fallback, source: 'haversine' })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
