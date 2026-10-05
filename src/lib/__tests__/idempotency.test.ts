import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// In-memory stand-in for the IdempotencyKey table with the real (tenantId, key) uniqueness —
// the atomic claim relies on that constraint, so the fake has to enforce it too.
type Row = { tenantId: string; key: string; route: string; requestHash: string; status: number; response: unknown; createdAt: Date }
const rows = vi.hoisted(() => new Map<string, Row>())
const TENANT = 'tenant-a'

const fakeDb = vi.hoisted(() => ({
  idempotencyKey: {
    create: vi.fn(async ({ data }: { data: Omit<Row, 'tenantId' | 'createdAt' | 'response'> }) => {
      const id = `tenant-a:${data.key}`
      if (rows.has(id)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      const row = { tenantId: 'tenant-a', response: null, createdAt: new Date(), ...data }
      rows.set(id, row)
      return row
    }),
    findUnique: vi.fn(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) =>
      rows.get(`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`) ?? null),
    updateMany: vi.fn(async ({ where, data }: { where: { key: string; status?: number; createdAt?: Date }; data: Partial<Row> }) => {
      const row = rows.get(`tenant-a:${where.key}`)
      if (!row) return { count: 0 }
      if (where.status !== undefined && row.status !== where.status) return { count: 0 }
      if (where.createdAt !== undefined && row.createdAt.getTime() !== where.createdAt.getTime()) return { count: 0 }
      Object.assign(row, data)
      return { count: 1 }
    }),
    deleteMany: vi.fn(async ({ where }: { where: { key: string; status?: number } }) => {
      const row = rows.get(`tenant-a:${where.key}`)
      if (row && (where.status === undefined || row.status === where.status)) { rows.delete(`tenant-a:${where.key}`); return { count: 1 } }
      return { count: 0 }
    }),
  },
}))
vi.mock('@/lib/tenantDb', () => ({ getTenantDb: () => fakeDb }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const { withIdempotency } = await import('../idempotency')

const KEY = 'sync-q:1700000000000-0d4c9a2e-7b1f'

function makeReq(idempotencyKey?: string): NextRequest {
  return new NextRequest('http://localhost/api/driver-status/update', {
    method: 'POST',
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  })
}

const BODY = { driverId: 'd1', missionId: 'm1', status: 'done' }

beforeEach(() => {
  vi.clearAllMocks()
  rows.clear()
})

describe('withIdempotency', () => {
  it('runs the handler directly when no Idempotency-Key header is present', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const res = await withIdempotency(makeReq(), TENANT, 'POST /x', BODY, handler)
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
    expect(fakeDb.idempotencyKey.create).not.toHaveBeenCalled()
  })

  it('rejects a malformed key without running the handler', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const res = await withIdempotency(makeReq('bad key!'), TENANT, 'POST /x', BODY, handler)
    expect(res.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
  })

  it('runs once, then replays the stored response for the same key', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true, n: 1 }, { status: 201 }))
    const first  = await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)
    const second = await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)
    expect(handler).toHaveBeenCalledOnce()
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(await second.json()).toEqual({ ok: true, n: 1 })
  })

  it('never runs the handler twice for two concurrent deliveries of the same action', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const handler = vi.fn(async () => { await gate; return NextResponse.json({ ok: true }) })

    const first  = withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)
    await new Promise(r => setTimeout(r, 0))
    const second = await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)
    expect(second.status).toBe(409)
    expect(second.headers.get('retry-after')).toBe('5')

    release()
    expect((await first).status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()

    // Once the first one is finished, a retry gets the stored response.
    const third = await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)
    expect(third.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('refuses to replay a key reused with a different body', async () => {
    await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, async () => NextResponse.json({ ok: true }))
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const res = await withIdempotency(makeReq(KEY), TENANT, 'POST /x', { ...BODY, missionId: 'm2' }, handler)
    expect(res.status).toBe(422)
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses to replay a key reused on another route', async () => {
    await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, async () => NextResponse.json({ ok: true }))
    const res = await withIdempotency(makeReq(KEY), TENANT, 'POST /y', BODY, async () => NextResponse.json({ ok: true }))
    expect(res.status).toBe(422)
  })

  it('releases the claim on a 5xx so the retry really runs again', async () => {
    const handler = vi.fn()
      .mockResolvedValueOnce(NextResponse.json({ error: 'down' }, { status: 503 }))
      .mockResolvedValueOnce(NextResponse.json({ ok: true }))
    expect((await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)).status).toBe(503)
    expect((await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)).status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('releases the claim when the handler throws', async () => {
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(NextResponse.json({ ok: true }))
    await expect(withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)).rejects.toThrow('boom')
    expect((await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)).status).toBe(200)
  })

  it('stores and replays a 4xx answer (a rejected action stays rejected)', async () => {
    const handler = vi.fn(async () => NextResponse.json({ error: 'Mission absente' }, { status: 404 }))
    await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)
    const res = await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)
    expect(res.status).toBe(404)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('takes over an abandoned claim (handler crashed mid-way, > 60s old)', async () => {
    rows.set(`tenant-a:${KEY}`, {
      tenantId: TENANT, key: KEY, route: 'POST /x', requestHash: '', status: 0, response: null,
      createdAt: new Date(Date.now() - 120_000),
    })
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const res = await withIdempotency(makeReq(KEY), TENANT, 'POST /x', BODY, handler)
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })
})
