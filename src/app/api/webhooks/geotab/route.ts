import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { recordOBDReading, pruneOldOBDData } from '@/lib/obdStore'
import { persistDriverPositions, type DriverPositionInput } from '@/lib/driverPositionPersist'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { createRateLimiter, getClientIp } from '@/lib/rateLimit'
import { decryptConfig } from '@/lib/configCrypto'

const _geotabRl = createRateLimiter(200, 60_000)

const log = createLogger('/api/webhooks/geotab')

const GeotabReadingSchema = z.object({
  deviceId:    z.string().optional(),
  device:      z.string().optional(),
  id:          z.string().optional(),
  latitude:    z.number().optional(),
  lat:         z.number().optional(),
  longitude:   z.number().optional(),
  lng:         z.number().optional(),
  lon:         z.number().optional(),
  speed:       z.number().optional(),
  speedKmh:    z.number().optional(),
  timestamp:   z.string().optional(),
  ignition:    z.boolean().optional(),
  engineRunning: z.boolean().optional(),
}).passthrough()

const GeotabPayloadSchema = z.union([
  z.array(GeotabReadingSchema).min(1).max(500),
  z.object({ data: z.array(GeotabReadingSchema).min(1).max(500) }),
  GeotabReadingSchema,
])

function apiKeyMatches(stored: string, provided: string): boolean {
  const maxLen = Math.max(stored.length, provided.length, 1)
  const a = Buffer.alloc(maxLen); a.write(stored,   0, 'utf8')
  const b = Buffer.alloc(maxLen); b.write(provided, 0, 'utf8')
  return timingSafeEqual(a, b) && stored.length === provided.length
}

let _pruneCounter = 0

export async function POST(req: NextRequest): Promise<NextResponse> {

  const ip = getClientIp(req.headers)
  if (!(await _geotabRl.check(ip))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const apiKey = req.headers.get('x-api-key') ?? ''
  if (!apiKey) return NextResponse.json({ error: 'API key required' }, { status: 401 })

  const integrations = await prisma.integration.findMany({
    where: { type: 'geotab', enabled: true },
    select: { tenantId: true, config: true },
  })
  // Each individual comparison in apiKeyMatches() is timingSafeEqual, but
  // .find() short-circuits on first match — a theoretical timing leak on WHICH POSITION in the
  // list matches, not on the secret's contents itself. Accepted risk (negligible in practice,
  // requires many timed requests + integration ordering knowledge to exploit for zero gain).
  const integration = integrations.find(i => {
    try {
      const cfg = decryptConfig(i.config)
      return apiKeyMatches(String(cfg.apiKey ?? ''), apiKey)
    } catch (err) {
      // A single tenant's corrupted/undecryptable config (e.g. INTEGRATION_ENCRYPTION_KEY
      // rotated or misconfigured) must not crash auth for every other tenant's valid Geotab
      // integration — skip it and keep looking.
      log.warn('Failed to decrypt integration config — skipping', {
        tenantId: i.tenantId, err: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  })
  if (!integration) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

  const config = decryptConfig(integration.config)

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = GeotabPayloadSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const readings = Array.isArray(parsed.data)
    ? parsed.data
    : 'data' in parsed.data
      ? (parsed.data as { data: z.infer<typeof GeotabReadingSchema>[] }).data
      : [parsed.data as z.infer<typeof GeotabReadingSchema>]

  const deviceMapping = new Map<string, string>()
  try {
    const mapping = JSON.parse(String(config.deviceMapping ?? '{}'))
    for (const [deviceId, driverId] of Object.entries(mapping)) {
      deviceMapping.set(deviceId, String(driverId))
    }
  } catch {  }

  const candidateDriverIds = new Set<string>()
  for (const r of readings) {
    const deviceId = String(r.deviceId ?? r.device ?? r.id ?? '')
    candidateDriverIds.add(deviceMapping.get(deviceId) ?? deviceId)
  }
  // driverId (from deviceMapping or raw payload) has no DB-level FK tying it to a tenant —
  // must be checked here or a misconfigured/malicious mapping could write GPS readings
  // attributed to another tenant's driver.
  const validDrivers = await prisma.driver.findMany({
    where: { id: { in: [...candidateDriverIds] }, tenantId: integration.tenantId },
    select: { id: true },
  })
  const validDriverIds = new Set(validDrivers.map(d => d.id))

  let recorded = 0
  const toPersist: DriverPositionInput[] = []
  for (const r of readings) {
    const deviceId = String(r.deviceId ?? r.device ?? r.id ?? '')
    const driverId = deviceMapping.get(deviceId) ?? deviceId
    const lat = r.latitude ?? r.lat ?? 0
    const lng = r.longitude ?? r.lng ?? r.lon ?? 0
    if (!lat || !lng) continue
    if (!validDriverIds.has(driverId)) {
      log.warn('Geotab reading skipped — driverId does not belong to this tenant', { tenantId: integration.tenantId, driverId })
      continue
    }

    const timestamp = r.timestamp ? new Date(r.timestamp).getTime() : Date.now()
    const speedKmh = r.speed ?? r.speedKmh ?? 0
    recordOBDReading({
      driverId,
      timestamp,
      lat,
      lng,
      speedKmh,
      ignition: r.ignition ?? r.engineRunning ?? true,
    })
    toPersist.push({ driverId, lat, lng, speedKmh, timestamp })
    recorded++
  }
  void persistDriverPositions(integration.tenantId, toPersist)

  if (++_pruneCounter >= 500) {
    _pruneCounter = 0
    pruneOldOBDData()
  }

  log.info('Geotab data received', { tenantId: integration.tenantId, recorded })
  return NextResponse.json({ ok: true, recorded })
}
