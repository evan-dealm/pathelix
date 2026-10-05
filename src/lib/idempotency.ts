import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getTenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'
import { Prisma } from '@/generated/prisma'

const log = createLogger('idempotency')

const IDEMPOTENCY_HEADER = 'idempotency-key'
const KEY_RE = /^[A-Za-z0-9:_-]{8,128}$/

/** A reservation older than this is considered abandoned (crashed handler) and can be retaken. */
const STALE_CLAIM_MS = 60_000

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === 'P2002'
}

/**
 * Exactly-once execution of a driver action replayed by the offline queue (src/lib/syncQueue.ts,
 * public/sw.js). The client generates one key per queued action, once, and sends it on every
 * retry as `Idempotency-Key`.
 *
 * 1. The key is *claimed* first (insert with status 0) — the unique (tenantId, key) constraint
 *    makes the claim atomic, so two concurrent deliveries of the same action can never both run
 *    the handler (a timed-out request still running server-side + its retry, two tabs…).
 * 2. The handler runs; its response is stored on the claim and replayed verbatim afterwards.
 *    A 5xx/exception releases the claim so the action can be retried.
 * 3. A key is bound to its route and request body: reusing it for a different action is
 *    rejected (422) instead of silently replaying an unrelated response.
 *
 * Concurrent duplicate while the first is still running → 409 + Retry-After (the queue retries).
 * No header → handler runs normally (online calls that don't come from the queue).
 */
export async function withIdempotency(
  req: NextRequest,
  tenantId: string,
  route: string,
  /** The already-parsed request payload — hashed to bind the key to this exact action. */
  payload: unknown,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const key = req.headers.get(IDEMPOTENCY_HEADER)
  if (!key) return handler()
  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: 'Idempotency-Key invalide' }, { status: 400 })
  }

  const requestHash = createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')
  const db = getTenantDb(tenantId)
  const where = { tenantId_key: { tenantId, key } }

  try {
    await db.idempotencyKey.create({
      data: { key, route, requestHash, status: 0 } as Parameters<typeof db.idempotencyKey.create>[0]['data'],
    })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err

    const existing = await db.idempotencyKey.findUnique({ where })
    if (!existing) return withIdempotency(req, tenantId, route, payload, handler) // released meanwhile — retry the claim
    if (existing.route !== route || (existing.requestHash && existing.requestHash !== requestHash)) {
      log.warn('Idempotency key reused for a different request', { route, key, storedRoute: existing.route })
      return NextResponse.json(
        { error: 'Idempotency-Key déjà utilisée pour une autre requête' },
        { status: 422 },
      )
    }
    if (existing.status === 0) {
      if (Date.now() - existing.createdAt.getTime() < STALE_CLAIM_MS) {
        return NextResponse.json(
          { error: 'Requête identique déjà en cours de traitement' },
          { status: 409, headers: { 'Retry-After': '5' } },
        )
      }
      // Abandoned claim (process died mid-handler): take it over.
      const taken = await db.idempotencyKey.updateMany({
        where: { key, status: 0, createdAt: existing.createdAt },
        data:  { createdAt: new Date() },
      })
      if (taken.count === 0) {
        return NextResponse.json(
          { error: 'Requête identique déjà en cours de traitement' },
          { status: 409, headers: { 'Retry-After': '5' } },
        )
      }
    } else {
      log.info('Idempotency replay — returning stored response', { route, key })
      return NextResponse.json(existing.response as object, { status: existing.status })
    }
  }

  let res: NextResponse
  try {
    res = await handler()
  } catch (err) {
    await db.idempotencyKey.deleteMany({ where: { key, status: 0 } }).catch(() => undefined)
    throw err
  }

  const body = await res.clone().json().catch(() => null)
  if (res.status >= 500 || body === null) {
    // Not a final answer — release the claim so the queued action is retried for real.
    await db.idempotencyKey.deleteMany({ where: { key, status: 0 } }).catch(() => undefined)
    return res
  }

  try {
    await db.idempotencyKey.updateMany({
      where: { key, status: 0 },
      data:  { status: res.status, response: body as Prisma.InputJsonValue },
    })
  } catch (err) {
    // The action itself succeeded — never fail the request over the replay record.
    log.error('Failed to persist idempotency response', { route, key, err: err instanceof Error ? err.message : String(err) })
  }
  return res
}
