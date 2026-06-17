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
vi.mock('@/lib/db', () => ({
  default: {
    driver:   { findUnique:  mockDriverFindUnique },
    auditLog: { create:      mockAuditLogCreate   },
    mission:  { findFirst:   mockMissionFindFirst  },
    $transaction: mockTransaction,
  },
}))

const mockPublish  = vi.hoisted(() => vi.fn())
const mockEmit     = vi.hoisted(() => vi.fn())
const mockCollect  = vi.hoisted(() => vi.fn())
const mockSyncERP  = vi.hoisted(() => vi.fn())
vi.mock('@/lib/driverStatusPubSub',  () => ({ publishStatusUpdate:       mockPublish  }))
vi.mock('@/lib/integrationEvents',   () => ({ emitEvent:                  mockEmit     }))
vi.mock('@/lib/metricCollector',     () => ({ collectInterventionMetric:  mockCollect  }))
vi.mock('@/lib/integrationERP',      () => ({ syncMissionToERP:           mockSyncERP  }))

import { POST } from '@/app/api/driver-status/update/route'

const SESSION_DRIVER = { sub: 'd1', driverRef: 'd1', role: 'driver', tenantId: 't1', exp: 9999999999, iat: 0 }
const SESSION_ADMIN  = { sub: 'u1', driverRef: undefined, role: 'admin', tenantId: 't1', exp: 9999999999, iat: 0 }

function makeReq(body: unknown, sessionCookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (sessionCookie !== undefined) headers['cookie'] = `session=${sessionCookie}`
  return new NextRequest('http://localhost/api/driver-status/update', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  driverId:  'd1',
  missionId: 'm1',
  date:      '2026-06-15',
  status:    'en_route',
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: transaction executes the callback
  mockTransaction.mockImplementation(async (fn: (_tx: unknown) => Promise<unknown>) => {
    const tx = {
      plan: { findFirst: mockPlanFindFirst, update: mockPlanUpdate },
    }
    return fn(tx)
  })
  mockAuditLogCreate.mockResolvedValue({})
  mockPublish.mockReturnValue(undefined)
  mockEmit.mockResolvedValue(undefined)
  mockCollect.mockResolvedValue(undefined)
  mockSyncERP.mockResolvedValue(undefined)
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
    mockPlanFindFirst.mockResolvedValueOnce({ id: 'plan1', statuses: {} })
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
    mockPlanFindFirst.mockResolvedValueOnce({ id: 'plan2', statuses: {} })
    mockPlanUpdate.mockResolvedValueOnce({})
    const res = await POST(makeReq(VALID_BODY, 'tok'))
    expect(res.status).toBe(200)
  })

  it('skips plan update when plan not found (no error)', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    mockPlanFindFirst.mockResolvedValueOnce(null)
    const res = await POST(makeReq(VALID_BODY, 'tok'))
    expect(res.status).toBe(200)
    expect(mockPlanUpdate).not.toHaveBeenCalled()
  })

  it('emits events and metrics when status=done', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    mockPlanFindFirst.mockResolvedValueOnce({ id: 'plan3', statuses: {} })
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
    mockPlanFindFirst.mockResolvedValueOnce({ id: 'plan4', statuses: {} })
    mockPlanUpdate.mockResolvedValueOnce({})
    await POST(makeReq(VALID_BODY, 'tok'))
    await new Promise(r => setTimeout(r, 0))
    expect(mockEmit).toHaveBeenCalledWith('t1', 'driver.en_route', expect.objectContaining({ missionId: 'm1' }))
  })

  it('publishes status update via pubsub', async () => {
    mockVerifySession.mockResolvedValueOnce(SESSION_DRIVER)
    mockDriverFindUnique.mockResolvedValueOnce({ tenantId: 't1', firstName: 'Jean', lastName: 'Dupont' })
    mockPlanFindFirst.mockResolvedValueOnce({ id: 'plan5', statuses: {} })
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
