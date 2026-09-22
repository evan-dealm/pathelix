import { NextRequest, NextResponse } from 'next/server'
import { getTenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { Prisma } from '@/generated/prisma'

const log = createLogger('idempotency')

const IDEMPOTENCY_HEADER = 'idempotency-key'

/**
 * Wraps a driver-action route handler so a replayed request (double network send, or a
 * duplicate flush despite the Web Locks coordination in src/lib/syncQueue.ts) returns the
 * original response instead of reprocessing the action. The client generates one UUID per
 * queued action (src/lib/syncQueue.ts's `QueuedAction.id`) and sends it as `Idempotency-Key`.
 *
 * No header present → behaves exactly as before (not every caller of these routes is the
 * offline queue — direct online submissions never send this header and don't need to).
 */
export async function withIdempotency(
  req: NextRequest,
  tenantId: string,
  route: string,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const key = req.headers.get(IDEMPOTENCY_HEADER)
  if (!key) return handler()

  const db = getTenantDb(tenantId)
  const existing = await db.idempotencyKey.findUnique({
    where: { tenantId_key: { tenantId, key } },
  })
  if (existing) {
    log.info('Idempotency replay — returning stored response', { route, key })
    return NextResponse.json(existing.response as object, { status: existing.status })
  }

  const res  = await handler()
  const body = await res.clone().json().catch(() => null)

  if (body !== null && res.status < 500) {
    try {
      await db.idempotencyKey.create({
        data: { key, route, status: res.status, response: body as Prisma.InputJsonValue } as Parameters<typeof db.idempotencyKey.create>[0]['data'],
      })
    } catch (err) {
      // P2002 (unique constraint): a concurrent duplicate request created the row first between
      // our findUnique above and this create — the response we're about to return is still
      // correct (it's what actually happened), just not the one that'll be replayed next time.
      // Anything else is a real error worth logging, but never worth failing the request over.
      if (!(err instanceof Error && (err as { code?: string }).code === 'P2002')) {
        log.error('Failed to persist idempotency key', { route, key, err: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  return res
}
