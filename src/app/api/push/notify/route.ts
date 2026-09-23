import { NextRequest, NextResponse } from 'next/server'
import { z }                         from 'zod'
import { getRequestContext }         from '@/lib/data/context'
import { createLogger }              from '@/lib/logger'
import { sendPushNotification }      from '@/lib/webPush'
import { getTenantDb }                from '@/lib/tenantDb'

const log = createLogger('/api/push/notify')

const NotifySchema = z.object({
  driverIds: z.array(z.string()).optional(),
  title:     z.string().max(100),
  body:      z.string().max(500),
  tag:       z.string().max(50).optional(),
  data:      z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)

  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = NotifySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Payload invalide' }, { status: 422 })

  const { driverIds, title, body: msgBody, tag, data } = parsed.data

  const db = getTenantDb(tenantId)
  const subs = await db.pushSubscription.findMany({
    where: {
      ...(driverIds ? { driverId: { in: driverIds } } : {}),
    },
  })

  if (subs.length === 0) return NextResponse.json({ sent: 0, message: 'Aucun abonné' })

  let sent = 0, failed = 0; const expired: string[] = []

  await Promise.all(subs.map(async sub => {
    const result = await sendPushNotification(sub, { title, body: msgBody, tag, data })
    if (result.ok) { sent++ }
    else {
      failed++
      if (result.expired) expired.push(sub.endpoint)
    }
  }))

  if (expired.length > 0) {
    await db.pushSubscription.deleteMany({ where: { endpoint: { in: expired } } })
    log.info('Expired subscriptions deleted', { tenantId, count: expired.length })
  }

  log.info('Push notifications sent', { tenantId, sent, failed, expiredDeleted: expired.length })
  return NextResponse.json({ sent, failed })
}
