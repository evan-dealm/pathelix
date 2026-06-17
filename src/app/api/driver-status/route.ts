import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { getStatusFromStore, setStatusInStore, getAllStatusesForDate, pruneOldStatusEntries } from '@/lib/statusStore'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getRequestContext } from '@/lib/data/context'
import prisma from '@/lib/db'

let _pruneCounter = 0

const log = createLogger('/api/driver-status')

const MISSION_STATUS = z.enum(['todo', 'doing', 'done'])

const DriverStatusPostSchema = z.object({
  driverId: z.string().min(1),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statuses: z.record(z.string().min(1), MISSION_STATUS),
})

let _publisher: import('ioredis').Redis | null = null

async function publishStatusUpdate(
  tenantId: string,
  date:     string,
  payload:  Record<string, Record<string, string>>,
): Promise<void> {
  if (!process.env.REDIS_HOST && !process.env.REDIS_URL) return

  try {
    if (!_publisher) {
      const { default: Redis } = await import('ioredis')
      const redisOpts = { lazyConnect: true, enableReadyCheck: false, maxRetriesPerRequest: null }
      _publisher = process.env.REDIS_URL
        ? new Redis(process.env.REDIS_URL, redisOpts)
        : new Redis({
            host: process.env.REDIS_HOST ?? 'localhost',
            port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
            ...redisOpts,
          })
    }
    const channel = `driver-status:${tenantId}:${date}`
    await _publisher.publish(channel, JSON.stringify(payload))
  } catch (err) {
    log.warn('Redis publish failed — SSE ne recevra pas cette mise à jour', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl
  const date     = searchParams.get('date')
  const driverId = searchParams.get('driverId')

  if (!date) {
    return NextResponse.json({ error: 'Paramètre date requis' }, { status: 400 })
  }

  const { tenantId } = getRequestContext(req)

  try {

    if (++_pruneCounter >= 200) {
      _pruneCounter = 0
      pruneOldStatusEntries()
    }

    if (driverId) {
      const statuses = await getStatusFromStore(tenantId, driverId, date)
      return NextResponse.json({ [driverId]: statuses })
    }

    const result = await getAllStatusesForDate(tenantId, date)
    return NextResponse.json(result)
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {

  const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null
  if (!session) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = DriverStatusPostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { driverId, date, statuses } = parsed.data

  try {

    const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { tenantId: true } })
    if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    const tenantId = driver.tenantId

    const isOwnDriver = session.driverRef === driverId || session.sub === driverId
    const isAdminOrDispatcher = (session.role === 'admin' || session.role === 'dispatcher') && session.tenantId === tenantId
    if (!isOwnDriver && !isAdminOrDispatcher) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const current = await getStatusFromStore(tenantId, driverId, date)
    const updated = { ...current, ...statuses }
    await setStatusInStore(tenantId, driverId, date, updated)

    void publishStatusUpdate(tenantId, date, { [driverId]: updated })

    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
