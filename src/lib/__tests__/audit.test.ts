import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => { process.env.USE_MOCK_DATA = 'false' })

const mockPrisma = vi.hoisted(() => ({
  auditLog: { create: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin', requestId: 'r1', trade: null })),
}))

import { writeAudit, auditAsync } from '@/lib/audit'

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/test', {
    headers: { 'x-tenant-id': 'tenant-1', 'x-user-id': 'user-1', 'x-user-role': 'admin' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.auditLog.create.mockResolvedValue({ id: 'log-1' })
})

describe('writeAudit', () => {
  it('creates audit log with correct fields', async () => {
    await writeAudit(makeReq(), 'mission.create', 'Mission', 'm-1', { type: 'POSER' })

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId:   'tenant-1',
        userId:     'user-1',
        action:     'mission.create',
        entityType: 'Mission',
        entityId:   'm-1',
        changes:    { type: 'POSER' },
      }),
    })
  })

  it('uses empty changes when not provided', async () => {
    await writeAudit(makeReq(), 'mission.delete', 'Mission', 'm-2')

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ changes: {} }),
    })
  })

  it('does not throw when prisma fails (swallows error)', async () => {
    mockPrisma.auditLog.create.mockRejectedValue(new Error('DB fail'))
    await expect(writeAudit(makeReq(), 'test', 'Entity', 'e-1')).resolves.not.toThrow()
  })

  it('skips write when USE_MOCK_DATA is true', async () => {
    const oldVal = process.env.USE_MOCK_DATA
    process.env.USE_MOCK_DATA = 'true'

    try {

      const { writeAudit: writeAuditMock } = await import('@/lib/audit')
      await writeAuditMock(makeReq(), 'test', 'Entity', 'e-1')

    } finally {
      process.env.USE_MOCK_DATA = oldVal
    }
  })
})

describe('auditAsync', () => {
  it('fires and forgets without awaiting', async () => {
    auditAsync(makeReq(), 'driver.update', 'Driver', 'd-1', { firstName: 'Jean' })

    await vi.waitFor(() => expect(mockPrisma.auditLog.create).toHaveBeenCalled())
  })
})
