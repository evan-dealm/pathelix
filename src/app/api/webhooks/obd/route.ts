import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { recordOBDReading, pruneOldOBDData } from '@/lib/obdStore'
import { createRateLimiter, getClientIp } from '@/lib/rateLimit'
import { decryptConfig } from '@/lib/configCrypto'
import prisma from '@/lib/db'

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

function tokenMatches(stored: string, provided: string): boolean {
  const maxLen = Math.max(stored.length, provided.length, 1)
  const a = Buffer.alloc(maxLen); a.write(stored,   0, 'utf8')
  const b = Buffer.alloc(maxLen); b.write(provided, 0, 'utf8')
  return timingSafeEqual(a, b) && stored.length === provided.length
}

let _pruneCounter = 0

export async function POST(req: NextRequest): Promise<NextResponse> {

  const ip = getClientIp(req.headers)
  if (!(await _obdRl.check(ip))) {
    return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 })
  }

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  if (!token) return NextResponse.json({ error: 'Token requis' }, { status: 401 })

  // The OBD webhook used to trust a single global OBD_WEBHOOK_TOKEN with
  // no tenant resolution at all — anyone holding the token could write GPS readings for any
  // driverId in the entire system, across every tenant. Now each tenant configures its own OBD
  // secret via Integration (type "obd"), mirroring the Geotab/Samsara/Nessy pattern, and the
  // tenant is resolved by which one's secret matches — the driverId can then actually be checked
  // against that tenant (below), which was structurally impossible before.
  const integrations = await prisma.integration.findMany({
    where: { type: 'obd', enabled: true },
    select: { tenantId: true, config: true },
  })

  let tenantId: string | null = null
  for (const integration of integrations) {
    try {
      const cfg = decryptConfig(integration.config)
      const secret = String(cfg.webhookSecret ?? cfg.secret ?? '')
      if (secret && tokenMatches(secret, token)) {
        tenantId = integration.tenantId
        break
      }
    } catch (err) {
      log.warn('Failed to decrypt integration config — skipping', {
        tenantId: integration.tenantId, err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (!tenantId) {
    log.warn('OBD webhook: token invalide')
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
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

  const candidateDriverIds = [...new Set(readings.map(r => r.driverId))]
  const validDrivers = await prisma.driver.findMany({
    where: { id: { in: candidateDriverIds }, tenantId },
    select: { id: true },
  })
  const validDriverIds = new Set(validDrivers.map(d => d.id))

  let recorded = 0
  for (const r of readings) {
    if (!validDriverIds.has(r.driverId)) {
      log.warn('OBD reading skipped — driverId does not belong to this tenant', { tenantId, driverId: r.driverId })
      continue
    }
    recordOBDReading({
      driverId:  r.driverId,
      timestamp: r.timestamp ?? now,
      lat:       r.lat,
      lng:       r.lng,
      speedKmh:  r.speedKmh,
      ignition:  r.ignition,
    })
    recorded++
  }

  if (++_pruneCounter >= 500) {
    _pruneCounter = 0
    pruneOldOBDData()
  }

  log.debug(`OBD: ${recorded} lecture(s) enregistrée(s)`)
  return NextResponse.json({ ok: true, count: recorded })
}
