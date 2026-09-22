import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockFindUnique = vi.hoisted(() => vi.fn())
const mockCreate     = vi.hoisted(() => vi.fn())
const getTenantDbMock = vi.hoisted(() => vi.fn(() => ({
  idempotencyKey: { findUnique: mockFindUnique, create: mockCreate },
})))
vi.mock('@/lib/tenantDb', () => ({ getTenantDb: getTenantDbMock }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const { withIdempotency } = await import('../idempotency')

function makeReq(idempotencyKey?: string): NextRequest {
  return new NextRequest('http://localhost/api/driver-status/update', {
    method: 'POST',
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('withIdempotency', () => {
  it('runs the handler directly when no Idempotency-Key header is present', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const res = await withIdempotency(makeReq(), 'tenant-a', 'POST /x', handler)

    expect(handler).toHaveBeenCalledOnce()
    expect(getTenantDbMock).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ ok: true })
  })

  it('runs the handler and stores the response on first call with a key', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const handler = vi.fn(async () => NextResponse.json({ ok: true, status: 'done' }, { status: 200 }))

    const res = await withIdempotency(makeReq('key-1'), 'tenant-a', 'POST /x', handler)

    expect(handler).toHaveBeenCalledOnce()
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { tenantId_key: { tenantId: 'tenant-a', key: 'key-1' } } })
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ key: 'key-1', route: 'POST /x', status: 200, response: { ok: true, status: 'done' } }),
    }))
    expect(await res.json()).toEqual({ ok: true, status: 'done' })
  })

  it('replays the stored response on a duplicate call, without invoking the handler again', async () => {
    mockFindUnique.mockResolvedValueOnce({ status: 200, response: { ok: true, status: 'done' } })
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))

    const res = await withIdempotency(makeReq('key-1'), 'tenant-a', 'POST /x', handler)

    expect(handler).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'done' })
  })

  it('does not persist a key for a 500 response — a failed action is worth retrying, not freezing', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const handler = vi.fn(async () => NextResponse.json({ error: 'boom' }, { status: 500 }))

    const res = await withIdempotency(makeReq('key-1'), 'tenant-a', 'POST /x', handler)

    expect(mockCreate).not.toHaveBeenCalled()
    expect(res.status).toBe(500)
  })

  it('still returns the handler response if persisting the idempotency key throws an unexpected error', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    mockCreate.mockRejectedValueOnce(new Error('DB down'))
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))

    const res = await withIdempotency(makeReq('key-1'), 'tenant-a', 'POST /x', handler)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('swallows a P2002 unique-constraint race (a concurrent duplicate created the row first) without erroring', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    mockCreate.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))

    const res = await withIdempotency(makeReq('key-1'), 'tenant-a', 'POST /x', handler)

    expect(res.status).toBe(200)
  })
})
