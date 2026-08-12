// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'

const mockClearStorage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/stores/planningStore', () => ({
  usePlanningStore: { persist: { clearStorage: mockClearStorage } },
}))

import { ImpersonationBanner } from '../ImpersonationBanner'

function mockFetchSequence(handlers: Record<string, () => Promise<unknown> | unknown>) {
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    const key = `${opts?.method ?? 'GET'} ${url}`
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (key.includes(pattern) || url.includes(pattern)) {
        return Promise.resolve({
          ok:   true,
          json: () => Promise.resolve(handler()),
        })
      }
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
}

beforeEach(() => {
  mockClearStorage.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ImpersonationBanner', () => {
  it('renders nothing when not impersonating (userId does not start with sa:)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({
      '/api/auth/me': () => ({ userId: 'user-1', role: 'admin', tenantId: 't1' }),
    }))
    const { container } = render(<ImpersonationBanner />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('shows the banner when impersonating (userId starts with sa:)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({
      '/api/auth/me': () => ({ userId: 'sa:orig-admin', role: 'admin', tenantId: 't1' }),
      '/api/superadmin/tenants/t1': () => ({ name: 'Tenant A' }),
    }))
    render(<ImpersonationBanner />)
    await waitFor(() => expect(screen.getByText(/Tenant A/)).toBeTruthy())
  })

  // Regression M6: exiting impersonation left plans/startTimes/etc cached in IndexedDB under a
  // fixed key, not scoped by tenant — a subsequent impersonation of a different tenant could
  // pick up stale entries from this one. clearStorage() must run before navigating away.
  it('clears planningStore before navigating away on exit', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({
      '/api/auth/me': () => ({ userId: 'sa:orig-admin', role: 'admin', tenantId: 't1' }),
      '/api/superadmin/tenants/t1': () => ({ name: 'Tenant A' }),
      'POST /api/superadmin/exit-impersonation': () => ({ redirectTo: '/superadmin' }),
    }))

    // jsdom throws on real navigation assignment — stub it out for this test only.
    const originalHref = window.location.href
    Object.defineProperty(window, 'location', {
      writable: true, value: { ...window.location, href: originalHref },
    })

    render(<ImpersonationBanner />)
    await waitFor(() => expect(screen.getByText(/Quitter l'impersonation/)).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByText(/Quitter l'impersonation/))
    })

    await waitFor(() => expect(mockClearStorage).toHaveBeenCalled())
  })

  it('clears planningStore even when exit-impersonation call fails (fallback logout path)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ userId: 'sa:orig-admin', role: 'admin', tenantId: 't1' }) })
      }
      if (url.includes('/api/superadmin/tenants/t1')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: 'Tenant A' }) })
      }
      if (url.includes('exit-impersonation') && opts?.method === 'POST') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }))

    Object.defineProperty(window, 'location', {
      writable: true, value: { ...window.location, href: window.location.href },
    })

    render(<ImpersonationBanner />)
    await waitFor(() => expect(screen.getByText(/Quitter l'impersonation/)).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByText(/Quitter l'impersonation/))
    })

    await waitFor(() => expect(mockClearStorage).toHaveBeenCalled())
  })
})
