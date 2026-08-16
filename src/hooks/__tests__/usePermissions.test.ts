// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { usePermissions, hasPerm } from '../usePermissions'

function mockFetchSequence(handlers: Record<string, () => unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) return Promise.resolve({ ok: true, json: () => Promise.resolve(handler()) })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('usePermissions', () => {
  it('admin gets the wildcard, bypassing the per-permission fetch', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({
      '/api/auth/me': () => ({ userId: 'u1', role: 'admin' }),
    }))
    const { result } = renderHook(() => usePermissions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(hasPerm(result.current.permissions, 'optimize')).toBe(true)
    expect(hasPerm(result.current.permissions, 'manage_settings')).toBe(true)
  })

  // Regression: the Optimiser button in ToursTab used to be unconditionally enabled — a
  // dispatcher with the 'optimize' permission explicitly revoked (via the Utilisateurs
  // granular permissions panel) could click it and only find out it was refused after the
  // server rejected the request with "Permission refusée". hasPerm() is what the button's
  // `disabled` prop is driven from now.
  it('dispatcher only gets their actual granted permissions', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({
      '/api/auth/me': () => ({ userId: 'u2', role: 'dispatcher' }),
      '/api/permissions': () => ({ userId: 'u2', role: 'dispatcher', permissions: ['manage_missions', 'manage_drivers'] }),
    }))
    const { result } = renderHook(() => usePermissions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(hasPerm(result.current.permissions, 'optimize')).toBe(false)
    expect(hasPerm(result.current.permissions, 'manage_missions')).toBe(true)
  })
})

describe('hasPerm', () => {
  it('treats the wildcard set as having every permission', () => {
    expect(hasPerm(new Set(['*']), 'anything')).toBe(true)
  })

  it('returns false for a permission not in the set', () => {
    expect(hasPerm(new Set(['manage_missions']), 'optimize')).toBe(false)
  })
})
