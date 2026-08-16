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
      '/api/settings': () => ({ tenantName: 'Tenant A' }),
    }))
    render(<ImpersonationBanner />)
    await waitFor(() => expect(screen.getByText(/Tenant A/)).toBeTruthy())
  })

  // Regression: /api/settings carries Cache-Control: private, max-age=120 with no Vary on the
  // session cookie — the URL is identical for every tenant. A superadmin switching
  // impersonation target twice within that window got the *previous* tenant's cached name
  // back after a hard navigation to the new tenant, even though the session was already
  // correctly the new one. This component must never read either fetch from the browser's
  // HTTP cache.
  it('fetches auth/me and settings with cache: no-store', async () => {
    const fetchMock = mockFetchSequence({
      '/api/auth/me': () => ({ userId: 'sa:orig-admin', role: 'admin', tenantId: 't1' }),
      '/api/settings': () => ({ tenantName: 'Tenant A' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ImpersonationBanner />)
    await waitFor(() => expect(screen.getByText(/Tenant A/)).toBeTruthy())

    for (const [url, opts] of fetchMock.mock.calls as [string, RequestInit?][]) {
      if (url.includes('/api/auth/me') || url.includes('/api/settings')) {
        expect(opts?.cache).toBe('no-store')
      }
    }
  })

  // Regression: banner used to call /api/superadmin/tenants/[id] to resolve the tenant name.
  // During impersonation the session's role is the target tenant's role (e.g. 'admin'), not
  // 'superadmin', so that route always 403s and the banner silently fell back to the raw
  // tenant id on every single impersonation. /api/settings is tenant-scoped and open to any
  // authenticated role, so it must be used instead.
  it('falls back to raw tenantId, not a crash, if /api/settings 403s (still exercises the real code path)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ userId: 'sa:orig-admin', role: 'admin', tenantId: 't1' }) })
      }
      if (url.includes('/api/settings')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    }))
    render(<ImpersonationBanner />)
    await waitFor(() => expect(screen.getByText(/GOD MODE/)).toBeTruthy())
    expect(screen.getByText('t1')).toBeTruthy()
  })

  it('does not call the superadmin-only tenant route while impersonating', async () => {
    const fetchMock = mockFetchSequence({
      '/api/auth/me': () => ({ userId: 'sa:orig-admin', role: 'admin', tenantId: 't1' }),
      '/api/settings': () => ({ tenantName: 'Tenant A' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ImpersonationBanner />)
    await waitFor(() => expect(screen.getByText(/Tenant A/)).toBeTruthy())
    expect(fetchMock.mock.calls.some((call: unknown[]) => (call[0] as string).includes('/api/superadmin/tenants/'))).toBe(false)
  })

  // Regression M6: exiting impersonation left plans/startTimes/etc cached in IndexedDB under a
  // fixed key, not scoped by tenant — a subsequent impersonation of a different tenant could
  // pick up stale entries from this one. clearStorage() must run before navigating away.
  it('clears planningStore before navigating away on exit', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({
      '/api/auth/me': () => ({ userId: 'sa:orig-admin', role: 'admin', tenantId: 't1' }),
      '/api/settings': () => ({ tenantName: 'Tenant A' }),
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
      if (url.includes('/api/settings')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ tenantName: 'Tenant A' }) })
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
