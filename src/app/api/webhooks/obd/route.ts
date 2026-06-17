import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { recordOBDReading, pruneOldOBDData } from '@/lib/obdStore'
import { createRateLimiter, getClientIp } from '@/lib/rateLimit'

const _obdRl = createRateLimiter(200, 60_000)

const log = createLogger('/api/webhooks/obd')

const OBDReadingSchema = z.object({
  driverId:  z.string().min(1),
  timestamp: z.number().int().positive().optional(),
  lat:       z.number().min(-90).max(90),
  lng:       z.number().min(-180).max(180),
  speedKmh:  z.number().min(0).max(130),
  ignition:  z.boolean().optional().default(true),
})

const OBDPayloadSchema = z.union([
  OBDReadingSchema,
  z.array(OBDReadingSchema).min(1).max(500),
])

let _pruneCounter = 0

export async function POST(req: NextRequest): Promise<NextResponse> {

  const ip = getClientIp(req.headers)
  if (!(await _obdRl.check(ip))) {
    return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 })
  }

  const token = process.env.OBD_WEBHOOK_TOKEN
  if (!token) {

    log.warn('OBD webhook: OBD_WEBHOOK_TOKEN non configuré — requêtes refusées')
    return NextResponse.json({ error: 'Webhook non configuré' }, { status: 503 })
  }
  {
    const auth     = req.headers.get('authorization') ?? ''
    const expected = `Bearer ${token}`
    const maxLen   = Math.max(auth.length, expected.length, 1)
    const a = Buffer.alloc(maxLen); a.write(auth,     0, 'utf8')
    const b = Buffer.alloc(maxLen); b.write(expected, 0, 'utf8')
    if (!timingSafeEqual(a, b) || auth.length !== expected.length) {
      log.warn('OBD webhook: token invalide')
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = OBDPayloadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const readings = Array.isArray(parsed.data) ? parsed.data : [parsed.data]
  const now = Date.now()

  for (const r of readings) {
    recordOBDReading({
      driverId:  r.driverId,
      timestamp: r.timestamp ?? now,
      lat:       r.lat,
      lng:       r.lng,
      speedKmh:  r.speedKmh,
      ignition:  r.ignition,
    })
  }

  if (++_pruneCounter >= 500) {
    _pruneCounter = 0
    pruneOldOBDData()
  }

  log.debug(`OBD: ${readings.length} lecture(s) enregistrée(s)`)
  return NextResponse.json({ ok: true, count: readings.length })
}
