import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  default: {
    userPermission: {
      findMany: vi.fn(),
    },
  },
}))

import {
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  hasPermission,
  invalidatePermCache,
  type Permission,
} from '@/lib/permissions'
import prisma from '@/lib/db'

const mockFindMany = prisma.userPermission.findMany as ReturnType<typeof vi.fn>

function permsResult(perms: string[]) {
  return perms.map(p => ({ permission: p }))
}

describe('ALL_PERMISSIONS', () => {
  it('has exactly 11 entries', () => {
    expect(ALL_PERMISSIONS).toHaveLength(11)
  })

  it('contains optimize', () => {
    expect(ALL_PERMISSIONS).toContain('optimize')
  })

  it('contains manage_drivers', () => {
    expect(ALL_PERMISSIONS).toContain('manage_drivers')
  })

  it('contains manage_exutoires', () => {
    expect(ALL_PERMISSIONS).toContain('manage_exutoires')
  })

  it('contains manage_missions', () => {
    expect(ALL_PERMISSIONS).toContain('manage_missions')
  })

  it('contains manage_vehicles', () => {
    expect(ALL_PERMISSIONS).toContain('manage_vehicles')
  })

  it('contains manage_users', () => {
    expect(ALL_PERMISSIONS).toContain('manage_users')
  })

  it('contains view_reports', () => {
    expect(ALL_PERMISSIONS).toContain('view_reports')
  })

  it('contains view_costs', () => {
    expect(ALL_PERMISSIONS).toContain('view_costs')
  })

  it('contains manage_settings', () => {
    expect(ALL_PERMISSIONS).toContain('manage_settings')
  })

  it('contains api_access', () => {
    expect(ALL_PERMISSIONS).toContain('api_access')
  })

  it('contains manage_integrations', () => {
    expect(ALL_PERMISSIONS).toContain('manage_integrations')
  })

  it('all entries are unique', () => {
    const unique = new Set(ALL_PERMISSIONS)
    expect(unique.size).toBe(ALL_PERMISSIONS.length)
  })
})

describe('DEFAULT_PERMISSIONS', () => {
  it('admin has all permissions', () => {
    expect(DEFAULT_PERMISSIONS.admin).toHaveLength(ALL_PERMISSIONS.length)
    for (const p of ALL_PERMISSIONS) {
      expect(DEFAULT_PERMISSIONS.admin).toContain(p)
    }
  })

  it('superadmin has all permissions', () => {
    expect(DEFAULT_PERMISSIONS.superadmin).toHaveLength(ALL_PERMISSIONS.length)
    for (const p of ALL_PERMISSIONS) {
      expect(DEFAULT_PERMISSIONS.superadmin).toContain(p)
    }
  })

  it('driver has no permissions', () => {
    expect(DEFAULT_PERMISSIONS.driver).toHaveLength(0)
  })

  it('dispatcher has optimize', () => {
    expect(DEFAULT_PERMISSIONS.dispatcher).toContain('optimize')
  })

  it('dispatcher has manage_missions', () => {
    expect(DEFAULT_PERMISSIONS.dispatcher).toContain('manage_missions')
  })

  it('dispatcher has manage_drivers', () => {
    expect(DEFAULT_PERMISSIONS.dispatcher).toContain('manage_drivers')
  })

  it('dispatcher has view_reports', () => {
    expect(DEFAULT_PERMISSIONS.dispatcher).toContain('view_reports')
  })

  it('dispatcher has manage_vehicles', () => {
    expect(DEFAULT_PERMISSIONS.dispatcher).toContain('manage_vehicles')
  })

  it('dispatcher does NOT have manage_users', () => {
    expect(DEFAULT_PERMISSIONS.dispatcher).not.toContain('manage_users')
  })

  it('dispatcher does NOT have api_access', () => {
    expect(DEFAULT_PERMISSIONS.dispatcher).not.toContain('api_access')
  })
})

describe('hasPermission — admin role', () => {
  beforeEach(() => {
    invalidatePermCache('user-admin')
    mockFindMany.mockReset()
  })

  it('admin returns true for optimize without querying prisma', async () => {
    const result = await hasPermission('user-admin', 'admin', 'optimize')
    expect(result).toBe(true)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('admin returns true for manage_users', async () => {
    const result = await hasPermission('user-admin', 'admin', 'manage_users')
    expect(result).toBe(true)
  })

  it('admin returns true for api_access', async () => {
    const result = await hasPermission('user-admin', 'admin', 'api_access')
    expect(result).toBe(true)
  })

  it('admin returns true for every permission', async () => {
    for (const perm of ALL_PERMISSIONS) {
      const result = await hasPermission('user-admin', 'admin', perm)
      expect(result).toBe(true)
    }
  })
})

describe('hasPermission — superadmin role', () => {
  beforeEach(() => {
    invalidatePermCache('user-superadmin')
    mockFindMany.mockReset()
  })

  it('superadmin returns true for optimize without querying prisma', async () => {
    const result = await hasPermission('user-superadmin', 'superadmin', 'optimize')
    expect(result).toBe(true)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('superadmin returns true for manage_integrations', async () => {
    const result = await hasPermission('user-superadmin', 'superadmin', 'manage_integrations')
    expect(result).toBe(true)
  })

  it('superadmin returns true for every permission', async () => {
    for (const perm of ALL_PERMISSIONS) {
      const result = await hasPermission('user-superadmin', 'superadmin', perm)
      expect(result).toBe(true)
    }
  })
})

describe('hasPermission — dispatcher with no custom permissions', () => {
  const userId = 'dispatcher-no-custom'

  beforeEach(() => {
    invalidatePermCache(userId)
    mockFindMany.mockReset()
    mockFindMany.mockResolvedValue([])
  })

  it('queries prisma.userPermission.findMany', async () => {
    await hasPermission(userId, 'dispatcher', 'optimize')
    expect(mockFindMany).toHaveBeenCalledOnce()
  })

  it('queries with correct userId filter', async () => {
    await hasPermission(userId, 'dispatcher', 'optimize')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId } }),
    )
  })

  it('returns true for optimize (in dispatcher defaults)', async () => {
    const result = await hasPermission(userId, 'dispatcher', 'optimize')
    expect(result).toBe(true)
  })

  it('returns true for manage_missions (in dispatcher defaults)', async () => {
    const result = await hasPermission(userId, 'dispatcher', 'manage_missions')
    expect(result).toBe(true)
  })

  it('returns true for view_reports (in dispatcher defaults)', async () => {
    const result = await hasPermission(userId, 'dispatcher', 'view_reports')
    expect(result).toBe(true)
  })

  it('returns false for manage_users (not in dispatcher defaults)', async () => {
    const result = await hasPermission(userId, 'dispatcher', 'manage_users')
    expect(result).toBe(false)
  })

  it('returns false for api_access (not in dispatcher defaults)', async () => {
    const result = await hasPermission(userId, 'dispatcher', 'api_access')
    expect(result).toBe(false)
  })

  it('returns false for manage_settings (not in dispatcher defaults)', async () => {
    const result = await hasPermission(userId, 'dispatcher', 'manage_settings')
    expect(result).toBe(false)
  })
})

describe('hasPermission — driver with no custom permissions', () => {
  const userId = 'driver-no-custom'

  beforeEach(() => {
    invalidatePermCache(userId)
    mockFindMany.mockReset()
    mockFindMany.mockResolvedValue([])
  })

  it('returns false for optimize', async () => {
    const result = await hasPermission(userId, 'driver', 'optimize')
    expect(result).toBe(false)
  })

  it('returns false for manage_missions', async () => {
    const result = await hasPermission(userId, 'driver', 'manage_missions')
    expect(result).toBe(false)
  })

  it('returns false for view_reports', async () => {
    const result = await hasPermission(userId, 'driver', 'view_reports')
    expect(result).toBe(false)
  })

  it('returns false for every permission', async () => {
    for (const perm of ALL_PERMISSIONS) {
      invalidatePermCache(userId)
      mockFindMany.mockResolvedValue([])
      const result = await hasPermission(userId, 'driver', perm)
      expect(result).toBe(false)
    }
  })
})

describe('hasPermission — custom permissions override defaults', () => {
  const userId = 'dispatcher-with-custom'

  beforeEach(() => {
    invalidatePermCache(userId)
    mockFindMany.mockReset()
  })

  it('custom permissions grant manage_users even for dispatcher', async () => {
    mockFindMany.mockResolvedValue(permsResult(['manage_users', 'optimize']))
    const result = await hasPermission(userId, 'dispatcher', 'manage_users')
    expect(result).toBe(true)
  })

  it('custom permissions restrict: optimize not granted if not in custom list', async () => {
    mockFindMany.mockResolvedValue(permsResult(['manage_missions']))
    const result = await hasPermission(userId, 'dispatcher', 'optimize')
    expect(result).toBe(false)
  })

  it('custom permissions take full precedence over defaults', async () => {

    mockFindMany.mockResolvedValue(permsResult(['view_reports']))
    const result = await hasPermission(userId, 'dispatcher', 'optimize')
    expect(result).toBe(false)
  })
})

describe('hasPermission — cache behaviour', () => {
  const userId = 'cached-user'

  beforeEach(() => {
    invalidatePermCache(userId)
    mockFindMany.mockReset()
  })

  it('second call does NOT call prisma.findMany again', async () => {
    mockFindMany.mockResolvedValue(permsResult(['optimize']))
    await hasPermission(userId, 'dispatcher', 'optimize')
    await hasPermission(userId, 'dispatcher', 'optimize')
    expect(mockFindMany).toHaveBeenCalledOnce()
  })

  it('third call still uses cache', async () => {
    mockFindMany.mockResolvedValue(permsResult(['optimize']))
    await hasPermission(userId, 'dispatcher', 'optimize')
    await hasPermission(userId, 'dispatcher', 'manage_missions')
    await hasPermission(userId, 'dispatcher', 'view_reports')
    expect(mockFindMany).toHaveBeenCalledOnce()
  })

  it('cached result returns correct permission check', async () => {
    mockFindMany.mockResolvedValue(permsResult(['optimize']))
    await hasPermission(userId, 'dispatcher', 'optimize')
    const result = await hasPermission(userId, 'dispatcher', 'manage_users')
    expect(result).toBe(false)
  })
})

describe('invalidatePermCache', () => {
  const userId = 'user-to-invalidate'

  beforeEach(() => {
    invalidatePermCache(userId)
    mockFindMany.mockReset()
  })

  it('after invalidation, next call re-queries prisma', async () => {
    mockFindMany.mockResolvedValue(permsResult(['optimize']))
    await hasPermission(userId, 'dispatcher', 'optimize')
    invalidatePermCache(userId)
    mockFindMany.mockResolvedValue(permsResult(['manage_missions']))
    await hasPermission(userId, 'dispatcher', 'optimize')
    expect(mockFindMany).toHaveBeenCalledTimes(2)
  })

  it('after invalidation, updated permissions are used', async () => {
    mockFindMany.mockResolvedValue(permsResult(['optimize']))
    await hasPermission(userId, 'dispatcher', 'manage_users')

    invalidatePermCache(userId)
    mockFindMany.mockResolvedValue(permsResult(['manage_users']))
    const result = await hasPermission(userId, 'dispatcher', 'manage_users')
    expect(result).toBe(true)
  })

  it('invalidating a user does not affect another user cache', async () => {
    const otherUserId = 'other-user-cache-test'
    invalidatePermCache(otherUserId)
    mockFindMany.mockResolvedValue(permsResult(['optimize']))
    await hasPermission(otherUserId, 'dispatcher', 'optimize')
    mockFindMany.mockReset()

    invalidatePermCache(userId)
    await hasPermission(otherUserId, 'dispatcher', 'optimize')
    expect(mockFindMany).not.toHaveBeenCalled()

    invalidatePermCache(otherUserId)
  })

  it('can be called without error for a user not in cache', () => {
    expect(() => invalidatePermCache('non-existent-user')).not.toThrow()
  })
})
