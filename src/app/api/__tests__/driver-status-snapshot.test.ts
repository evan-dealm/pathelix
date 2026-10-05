import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const ctx = vi.hoisted(() => ({ value: { tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'r', trade: null, driverRef: null as string | null } }))
vi.mock('@/lib/data/context', () => ({ getRequestContext: () => ctx.value }))

const mockFindMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenantDb', () => ({ getTenantDb: () => ({ plan: { findMany: mockFindMany } }) }))

import { GET } from '@/app/api/driver-status/route'

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/driver-status?${qs}`))

beforeEach(() => {
  mockFindMany.mockReset()
  ctx.value = { tenantId: 't1', userId: 'u1', role: 'admin', requestId: 'r', trade: null, driverRef: null }
})

describe('GET /api/driver-status (read from Plan.statuses, not an in-memory store)', () => {
  it('requires a date', async () => {
    expect((await get('')).status).toBe(400)
  })

  it('returns the persisted progress of every driver for staff', async () => {
    mockFindMany.mockResolvedValue([
      { driverId: 'd1', statuses: { m1: { status: 'done', doneAt: 'x' }, m2: { status: 'en_route' } } },
      { driverId: 'd2', statuses: {} },
      { driverId: 'd3', statuses: { m9: { status: 'bogus' } } },
    ])
    const res = await get('date=2026-10-05')
    expect(await res.json()).toEqual({ d1: { m1: 'done', m2: 'en_route' } })
    expect(mockFindMany.mock.calls[0][0].where).toEqual({ date: '2026-10-05' })
  })

  it('a driver only ever gets its own entry, whatever driverId it asks for', async () => {
    ctx.value = { ...ctx.value, role: 'driver', driverRef: 'd1' }
    mockFindMany.mockResolvedValue([])
    await get('date=2026-10-05&driverId=d2')
    expect(mockFindMany.mock.calls[0][0].where).toEqual({ date: '2026-10-05', driverId: 'd1' })
  })
})
