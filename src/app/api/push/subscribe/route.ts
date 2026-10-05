import { NextRequest, NextResponse } from 'next/server'
import { z }                         from 'zod'
import { getRequestContext }         from '@/lib/data/context'
import { createLogger }              from '@/lib/logger'
import { VAPID_PUBLIC_KEY }          from '@/lib/webPush'
import { getTenantDb }                from '@/lib/tenantDb'
import { isStaff }                   from '@/lib/driverAccess'
import { isAllowedPushEndpoint }     from '@/lib/pushEndpoints'

const log = createLogger('/api/push/subscribe')

const SubscribeSchema = z.object({
  // The server later POSTs to this URL — only real browser push services are accepted (SSRF).
  endpoint: z.string().url().max(1000).refine(isAllowedPushEndpoint, 'Service push non reconnu'),
  keys:     z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  driverId: z.string().max(100).optional(),
})

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ publicKey: VAPID_PUBLIC_KEY })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId, role, driverRef } = getRequestContext(req)

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = SubscribeSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Payload invalide' }, { status: 422 })

  const { endpoint, keys, driverId } = parsed.data

  // PushSubscription.driverId has no DB-level FK — same pattern as
  // DeliveryProof/FuelRecord: must be checked against tenantId here or a subscription could
  // reference a driver belonging to a different tenant.
  const db = getTenantDb(tenantId)

  if (driverId) {
    const driver = await db.driver.findFirst({
      where:  { id: driverId },
      select: { id: true },
    })
    if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    // A driver subscribes for itself only — never to receive a colleague's notifications.
    if (!isStaff(role) && driverId !== (driverRef ?? userId)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
  }

  try {
    await db.pushSubscription.upsert({
      where:  { tenantId_endpoint: { tenantId, endpoint } },
      create: { userId, driverId, endpoint, p256dh: keys.p256dh, auth: keys.auth } as Parameters<typeof db.pushSubscription.upsert>[0]['create'],
      update: { userId, driverId, p256dh: keys.p256dh, auth: keys.auth },
    })
    log.info('Push subscription saved', { tenantId, userId, endpoint: endpoint.slice(0, 40) })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('Subscribe failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)
  const endpoint     = req.nextUrl.searchParams.get('endpoint')
  if (!endpoint) return NextResponse.json({ error: 'endpoint requis' }, { status: 400 })

  try {
    await getTenantDb(tenantId).pushSubscription.deleteMany({ where: { endpoint } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
