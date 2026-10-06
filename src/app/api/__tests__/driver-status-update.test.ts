import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const mockVerifySession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session', () => ({
  verifySession:  mockVerifySession,
  SESSION_COOKIE: 'session',
}))

const mockDriverFindUnique  = vi.hoisted(() => vi.fn())
const mockPlanFindFirst     = vi.hoisted(() => vi.fn())
const mockPlanUpdate        = vi.hoisted(() => vi.fn())
const mockAuditLogCreate    = vi.hoisted(() => vi.fn())
const mockMissionFindFirst  = vi.hoisted(() => vi.fn())
const mockTransaction       = vi.hoisted(() => vi.fn())

const mockPublish  = vi.hoisted(() => vi.fn())
const mockEmit     = vi.hoisted(() => vi.fn())
const mockCollect  = vi.hoisted(() => vi.fn())
const mockBusiness = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/driverStatusPubSub',  () => ({ publishStatusUpdate:       mockPublish  }))
vi.mock('@/lib/integrationEvents',   () => ({ emitEvent:                  mockEmit     }))
vi.mock('@/lib/metricCollector',     () => ({ collectInterventionMetric:  mockCollect  }))
vi.mock('@/lib/events/outbound',      () => ({ emitBusinessEvent:          mockBusiness }))
const completedEvents = () => mockBusiness.mock.calls.filter(c => (c as unknown[])[1] === 'mission.completed').length

// Only exercised by requests carrying an Idempotency-Key header (see idempotency.test.ts for
// full unit coverage of withIdempotency itself) — an in-memory table with the real
// (tenantId, key) uniqueness is enough to prove the route wiring prevents a duplicate side effect.
const idemRows = vi.hoisted(() => new Map<string, Record<string, unknown>>())
const idemDb = vi.hoisted(() => ({
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const id = String(data.key)
    if (idemRows.has(id)) throw Object.assign(new Error('unique'), { code: 'P2002' })
    idemRows.set(id, { ...data, createdAt: new Date() })
    return data
  }),
  findUnique: vi.fn(async ({ where }: { where: { tenantId_key: { key: string } } }) => idemRows.get(where.tenantId_key.key) ?? null),
  updateMany: vi.fn(async ({ where, data }: { where: { key: string }; data: Record<string, unknown> }) => {
    const row = idemRows.get(where.key); if (row) Object.assign(row, data); return { count: row ? 1 : 0 }
  }),
  deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => ({ count: idemRows.delete(where.key) ? 1 : 0 })),
}))
const mockMissionUpdateMany = vi.hoisted(() => vi.fn(async () => ({ count: 1 })))
const mockQueryRaw = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => [] as unknown[]))
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: { driver: { findUnique: mockDriverFindUnique } },
  getTenantDb: () => ({
    idempotencyKey: idemDb,
    auditLog:       { create: mockAuditLogCreate },
    mission:        { findFirst: mockMissionFindFirst },
    $transaction:   mockTransaction,
  }),
}))
vi.mock('@/lib/data/context', () => ({ checkTenantSuspension: vi.fn(async () => null) }))

import { POST } from '@/app/api/driver-status/update/route'

const SESSION_DRIVER = { sub: 'd1', driverRef: 'd1', role: 'driver', tenantId: 't1', exp: 9999999999, iat: 0 }
const SESSION_ADMIN  = { sub: 'u1', driverRef: undefined, role: 'admin', tenantId: 't1', exp: 9999999999, iat: 0 }

function makeReq(body: unknown, sessionCookie?: string, idempotencyKey?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (sessionCookie !== undefined) headers['cookie'] = `session=${sessionCookie}`
  if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey
  return new NextRequest('http://localhost/api/driver-status/update', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const PLAN = { id: 'plan1', statuses: {}, missions: [{ id: 'm1' }, { id: 'vider-1' }, { id: '_vider_e1_m1' }] }

const VALID_BODY = {
  driverId:  'd1',
  missionId: 'm1',
  date:      '2026-06-15',
  status:    'en_route',
}

beforeEach(() => {
  vi.clearAllMocks()
  idemRows.clear()
  mockPlanFindFirst.mockReset()
  mockPlanFindFirst.mockResolvedValue(PLAN)
  // Default: transaction executes the callback
  mockTransaction.mockImplementation(async (fn: (_tx: unknown) => Promise<unknown>) => {
    const tx = {
      plan:     { findFirst: mockPlanFindFirst, update: mockPlanUpdate },
      auditLog: { create: mockAuditLogCreate },
      mission:  { updateMany: mockMissionUpdateMany },
      $queryRaw: mockQueryRaw,
    }
    return fn(tx)
  })
  mockAuditLogCreate.mockResolvedValue({})
  mockPublish.mockReturnValue(undefined)
  mockEmit.mockResolvedValue(undefined)
  mockCollect.mockResolvedValue(undefined)
})

describe('POST /api/driver-status/update — mission completion', () => {
  it('records completedAt on the mission row when the step is done', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'A', lastName: 'B' })
    mockPlanUpdate.mockResolvedValueOnce({})
    mockMissionFindFirst.mockResolvedValueOnce({ type: 'POSER', clientName: 'C', wasteTypeLabel: null, address: 'x' })
    const res = await POST(makeReq({ ...VALID_BODY, status: 'done' }, 'tok'))
    expect(res.status).toBe(200)
    expect(mockMissionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1', completedAt: null } }))
  })
})

describe('POST /api/driver-status/update', () => {
  it('returns 401 when no session cookie', async () => {
    const req = new NextRequest('http://localhost/api/driver-status/update', {
      method: 'POST',
      body: JSON.stringify(VALID_BODY),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when session invalid', async () => {
    mockVerifySession.mockResolvedValueOnce(null)
    const res = await POST(makeReq(VALID_BODY, 'bad-token'))
    expect(res.status).toBe(401)
  })

  it('returns 422 when driverId is missing', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    const res = await POST(makeReq({ missionId: 'm1', date: '2026-06-15', status: 'en_route' }, 'tok'))
    expect(res.status).toBe(422)
  })

  it('returns 422 when status is invalid', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    const res = await POST(makeReq({ ...VALID_BODY, status: 'flying' }, 'tok'))
    expect(res.status).toBe(422)
  })

  it('returns 422 when date format invalid', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    const res = await POST(makeReq({ ...VALID_BODY, date: '15/06/2026' }, 'tok'))
    expect(res.status).toBe(422)
  })

  it('returns 404 when driver not found', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce(null)
    const res = await POST(makeReq(VALID_BODY, 'tok'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when driver updates another driver without admin role', async () => {
    mockVerifySession.mockResolvedValueOnce({ ...SESSION_DRIVER, sub: 'other', driverRef: 'other' })
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    const res = await POST(makeReq(VALID_BODY, 'tok'))
    expect(res.status).toBe(403)
  })

  it('returns 200 when driver updates own status', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    mockPlanUpdate.mockResolvedValueOnce({})
    const res = await POST(makeReq(VALID_BODY, 'tok'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe('en_route')
  })

  it('returns 200 when admin updates any driver', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_ADMIN)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Paul', lastName: 'Martin' })
    mockPlanUpdate.mockResolvedValueOnce({})
    const res = await POST(makeReq(VALID_BODY, 'tok'))
    expect(res.status).toBe(200)
  })

  it('returns 404 (status not silently dropped) when no plan exists for that driver/date', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    mockPlanFindFirst.mockResolvedValueOnce(null)
    const res = await POST(makeReq(VALID_BODY, 'tok'))
    expect(res.status).toBe(404)
    expect(mockPlanUpdate).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('refuses a status on a mission that is not in this driver\'s plan (no completion event for someone else\'s mission)', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    const res = await POST(makeReq({ ...VALID_BODY, missionId: 'foreign-mission', status: 'done' }, 'tok'))
    expect(res.status).toBe(404)
    await new Promise(r => setTimeout(r, 0))
    expect(mockPlanUpdate).not.toHaveBeenCalled()
    expect(completedEvents()).toBe(0)
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it("accepts the 'doing' step the driver app sends (was rejected with 422 before)", async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    const res = await POST(makeReq({ ...VALID_BODY, status: 'doing' }, 'tok'))
    expect(res.status).toBe(200)
    expect(mockPlanUpdate.mock.calls[0][0].data.statuses.m1).toMatchObject({ status: 'doing' })
  })

  it('locks the plan row before the read-modify-write and writes the audit row in the same transaction', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    await POST(makeReq(VALID_BODY, 'tok'))
    expect(mockQueryRaw).toHaveBeenCalledOnce()
    expect(String(mockQueryRaw.mock.calls[0][0])).toContain('FOR UPDATE')
    expect(mockAuditLogCreate).toHaveBeenCalledOnce()
    expect(mockQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(mockPlanUpdate.mock.invocationCallOrder[0])
  })

  it('a synthetic step (VIDER) is not reported as a completed mission', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    mockMissionFindFirst.mockResolvedValueOnce(null)
    const res = await POST(makeReq({ ...VALID_BODY, missionId: '_vider_e1_m1', status: 'done' }, 'tok'))
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    expect(completedEvents()).toBe(0)
  })

  it('emits events and metrics when status=done', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    mockPlanUpdate.mockResolvedValueOnce({})
    mockMissionFindFirst.mockResolvedValueOnce({ type: 'POSER', clientName: 'Client A', wasteTypeLabel: 'OM', address: '1 Rue' })

    const res = await POST(makeReq({ ...VALID_BODY, status: 'done' }, 'tok'))
    expect(res.status).toBe(200)
    // Need to wait for void promises
    await new Promise(r => setTimeout(r, 0))
    expect(mockEmit).toHaveBeenCalledWith('t1', 'mission.done', expect.objectContaining({ missionId: 'm1' }))
  })

  it('emits en_route event when status=en_route', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    mockPlanUpdate.mockResolvedValueOnce({})
    await POST(makeReq(VALID_BODY, 'tok'))
    await new Promise(r => setTimeout(r, 0))
    expect(mockEmit).toHaveBeenCalledWith('t1', 'driver.en_route', expect.objectContaining({ missionId: 'm1' }))
  })

  it('publishes status update via pubsub', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    mockPlanUpdate.mockResolvedValueOnce({})
    await POST(makeReq(VALID_BODY, 'tok'))
    expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({
      tenantId:  't1',
      driverId:  'd1',
      missionId: 'm1',
      status:    'en_route',
    }))
  })

  it('returns 500 on DB error', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockRejectedValueOnce(new Error('DB crash'))
    const res = await POST(makeReq(VALID_BODY, 'tok'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/driver-status/update — idempotent replay (offline queue duplicate flush)', () => {
  it('a "done" status sent twice with the same Idempotency-Key only reports the completion once', async () => {
    mockVerifySession.mockResolvedValue(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValue({ tenantId: 't1', firstName: 'A', lastName: 'B' })
    mockMissionFindFirst.mockResolvedValue({ type: 'POSER', clientName: 'Client A', wasteTypeLabel: 'OM', address: '1 Rue' })

    const body = { ...VALID_BODY, status: 'done' }
    const req1 = makeReq(body, 'tok', 'idem-key-0001')
    const res1 = await POST(req1)
    expect(res1.status).toBe(200)
    expect(completedEvents()).toBe(1)
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1)

    const req2 = makeReq(body, 'tok', 'idem-key-0001')
    const res2 = await POST(req2)
    expect(res2.status).toBe(200)
    expect(await res2.json()).toEqual(await res1.clone().json())

    // The real bug this closes: without idempotency, replaying the request re-runs the whole
    // handler — a second completion event and a second audit log row for the same physical action.
    expect(completedEvents()).toBe(1)
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1)
  })

  it('two different Idempotency-Keys are treated as two genuinely different actions', async () => {
    mockVerifySession.mockResolvedValue(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValue({ tenantId: 't1', firstName: 'A', lastName: 'B' })
    mockMissionFindFirst.mockResolvedValue({ type: 'POSER', clientName: 'Client A', wasteTypeLabel: 'OM', address: '1 Rue' })

    await POST(makeReq({ ...VALID_BODY, status: 'done' }, 'tok', 'idem-key-000a'))
    await POST(makeReq({ ...VALID_BODY, status: 'done' }, 'tok', 'idem-key-000b'))

    expect(completedEvents()).toBe(2)
  })
})
