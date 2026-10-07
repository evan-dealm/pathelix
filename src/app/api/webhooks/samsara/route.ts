import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { persistDriverPositions, type DriverPositionInput } from '@/lib/driverPositionPersist'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { createRateLimiter, getClientIp } from '@/lib/rateLimit'
import { decryptConfig } from '@/lib/configCrypto'

const _samsaraRl = createRateLimiter(200, 60_000, { redis: true, prefix: 'rl:samsara' })

const log = createLogger('/api/webhooks/samsara')

const SamsaraEventSchema = z.object({
  vehicle: z.object({
    name: z.string().optional(),
    id:   z.string().optional(),
  }).optional(),
  driverId: z.string().optional(),
  time:     z.string().optional(),
  location: z.object({
    latitude:  z.number().optional(),
    longitude: z.number().optional(),
    lat:       z.number().optional(),
    lng:       z.number().optional(),
    speed:     z.number().optional(),
    speedKmh:  z.number().optional(),
    ignition:  z.boolean().optional(),
  }).optional(),
  gps: z.object({
    latitude:  z.number().optional(),
    longitude: z.number().optional(),
    lat:       z.number().optional(),
    lng:       z.number().optional(),
    speed:     z.number().optional(),
  }).optional(),
  engineState: z.object({ value: z.string().optional() }).optional(),
}).passthrough()

const SamsaraPayloadSchema = z.union([
  z.array(SamsaraEventSchema).min(1).max(500),
  z.object({ data: z.array(SamsaraEventSchema).min(1).max(500) }),
  SamsaraEventSchema,
])

function tokenMatches(stored: string, provided: string): boolean {
  const maxLen = Math.max(stored.length, provided.length, 1)
  const a = Buffer.alloc(maxLen); a.write(stored,   0, 'utf8')
  const b = Buffer.alloc(maxLen); b.write(provided, 0, 'utf8')
  return timingSafeEqual(a, b) && stored.length === provided.length
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req.headers)
  if (!(await _samsaraRl.check(ip))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 401 })

  const integrations = await prisma.integration.findMany({
    where: { type: 'samsara', enabled: true },
    select: { tenantId: true, config: true },
  })
  // Same accepted theoretical timing leak as the Geotab route — each
  // comparison is timingSafeEqual but .find() short-circuits on first match, leaking position
  // in the list, not the secret's contents. Negligible in practice.
  const integration = integrations.find(i => {
    try {
      const cfg = decryptConfig(i.config)
      return tokenMatches(String(cfg.apiToken ?? ''), token)
    } catch (err) {
      // A single tenant's corrupted/undecryptable config must not crash auth for every other
      // tenant's valid Samsara integration — skip it and keep looking.
      log.warn('Failed to decrypt integration config — skipping', {
        tenantId: i.tenantId, err: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  })
  if (!integration) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = SamsaraPayloadSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const events = Array.isArray(parsed.data)
    ? parsed.data
    : 'data' in parsed.data
      ? (parsed.data as { data: z.infer<typeof SamsaraEventSchema>[] }).data
      : [parsed.data as z.infer<typeof SamsaraEventSchema>]

  const candidateDriverIds = new Set<string>()
  for (const e of events) {
    const vehicle = e.vehicle ?? {}
    const driverId = String(vehicle.name ?? vehicle.id ?? e.driverId ?? '')
    if (driverId) candidateDriverIds.add(driverId)
  }
  // driverId has no DB-level FK tying it to a tenant — must be checked here or a Samsara
  // payload could write GPS readings attributed to another tenant's driver.
  const validDrivers = await prisma.driver.findMany({
    where: { id: { in: [...candidateDriverIds] }, tenantId: integration.tenantId },
    select: { id: true },
  })
  const validDriverIds = new Set(validDrivers.map(d => d.id))

  let recorded = 0
  const toPersist: DriverPositionInput[] = []

  for (const e of events) {
    const vehicle   = e.vehicle ?? {}
    const location  = e.location ?? e.gps ?? {}
    const driverId  = String(vehicle.name ?? vehicle.id ?? e.driverId ?? '')
    const lat       = Number((location as Record<string, unknown>).latitude ?? (location as Record<string, unknown>).lat ?? 0)
    const lng       = Number((location as Record<string, unknown>).longitude ?? (location as Record<string, unknown>).lng ?? 0)
    if (!lat || !lng || !driverId) continue
    if (!validDriverIds.has(driverId)) {
      log.warn('Samsara reading skipped — driverId does not belong to this tenant', { tenantId: integration.tenantId, driverId })
      continue
    }

    const timestamp = e.time ? new Date(e.time).getTime() : Date.now()
    const speedKmh = Number((location as Record<string, unknown>).speed ?? (location as Record<string, unknown>).speedKmh ?? 0)
    toPersist.push({ driverId, lat, lng, speedKmh, timestamp })
    recorded++
  }
  await persistDriverPositions(integration.tenantId, toPersist)


  log.info('Samsara data received', { tenantId: integration.tenantId, recorded })
  return NextResponse.json({ ok: true, recorded })
}
