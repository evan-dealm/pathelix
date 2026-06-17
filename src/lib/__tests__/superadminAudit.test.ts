import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isSuperadminSession, extractSuperadminId, auditSuperadminRequest } from '../superadminAudit'

vi.mock('@/lib/db', () => ({
  default: {
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

describe('isSuperadminSession', () => {
  it('returns true for role superadmin', () => {
    expect(isSuperadminSession('user-123', 'superadmin')).toBe(true)
  })

  it('returns true for sa: prefixed userId', () => {
    expect(isSuperadminSession('sa:user-123', 'admin')).toBe(true)
  })

  it('returns true for both conditions', () => {
    expect(isSuperadminSession('sa:user-123', 'superadmin')).toBe(true)
  })

  it('returns false for regular admin', () => {
    expect(isSuperadminSession('user-123', 'admin')).toBe(false)
  })

  it('returns false for dispatcher', () => {
    expect(isSuperadminSession('user-123', 'dispatcher')).toBe(false)
  })

  it('returns false for driver', () => {
    expect(isSuperadminSession('user-123', 'driver')).toBe(false)
  })
})

describe('extractSuperadminId', () => {
  it('strips sa: prefix', () => {
    expect(extractSuperadminId('sa:user-123')).toBe('user-123')
  })

  it('returns unchanged if no sa: prefix', () => {
    expect(extractSuperadminId('user-123')).toBe('user-123')
  })

  it('handles sa: at start only', () => {
    expect(extractSuperadminId('sa:sa:nested')).toBe('sa:nested')
  })

  it('handles empty string', () => {
    expect(extractSuperadminId('')).toBe('')
  })
})

describe('auditSuperadminRequest', () => {
  it('does nothing for non-superadmin sessions', async () => {
    const prisma = (await import('@/lib/db')).default
    vi.clearAllMocks()
    auditSuperadminRequest('user-123', 'admin', 'tenant-1', 'GET', '/api/data', 'read')
    await new Promise(r => setTimeout(r, 10))
    expect((prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('fires for superadmin role', async () => {
    const prisma = (await import('@/lib/db')).default
    vi.clearAllMocks()
    auditSuperadminRequest('user-123', 'superadmin', 'tenant-1', 'GET', '/api/data', 'read')
    await new Promise(r => setTimeout(r, 10))
    expect((prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  it('fires for sa: prefixed userId', async () => {
    const prisma = (await import('@/lib/db')).default
    vi.clearAllMocks()
    auditSuperadminRequest('sa:user-123', 'admin', 'tenant-1', 'POST', '/api/missions', 'create')
    await new Promise(r => setTimeout(r, 10))
    expect((prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  it('passes isImpersonation=true for sa: prefix', async () => {
    const prisma = (await import('@/lib/db')).default
    vi.clearAllMocks()
    auditSuperadminRequest('sa:user-123', 'admin', 'tenant-1', 'POST', '/api/missions', 'create')
    await new Promise(r => setTimeout(r, 10))
    const call = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0].data.changes.isImpersonation).toBe(true)
  })

  it('passes isImpersonation=false for direct superadmin', async () => {
    const prisma = (await import('@/lib/db')).default
    vi.clearAllMocks()
    auditSuperadminRequest('user-123', 'superadmin', 'tenant-1', 'GET', '/api/data', 'read')
    await new Promise(r => setTimeout(r, 10))
    const call = (prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0].data.changes.isImpersonation).toBe(false)
  })
})
