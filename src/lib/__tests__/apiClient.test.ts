import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiErrorMessage, apiRequest, fetchAllPages } from '@/lib/apiClient'

afterEach(() => vi.unstubAllGlobals())

describe('apiErrorMessage', () => {
  it('passes a plain error string through', () => {
    expect(apiErrorMessage({ error: 'Mission introuvable' }, 404)).toBe('Mission introuvable')
  })

  it('renders a flattened Zod error readably (it used to show "[object Object]" or crash React)', () => {
    const msg = apiErrorMessage({ error: { formErrors: [], fieldErrors: { password: ['Le mot de passe doit contenir au moins 12 caractères'] } } }, 422)
    expect(msg).toBe('Mot de passe : Le mot de passe doit contenir au moins 12 caractères')
  })

  it('falls back to a sentence per status', () => {
    expect(apiErrorMessage(null, 403)).toMatch(/permission/)
    expect(apiErrorMessage({}, 503)).toMatch(/serveur/)
  })
})

describe('apiRequest', () => {
  it('never throws on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await apiRequest('/api/x')).toEqual({ ok: false, status: 0, error: 'Réseau indisponible — réessayez.' })
  })

  it('sends JSON bodies and returns parsed data', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await apiRequest<{ id: string }>('/api/missions', { method: 'POST', json: { a: 1 } })
    expect(res).toEqual({ ok: true, status: 201, data: { id: 'm1' } })
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.body).toBe('{"a":1}')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})

describe('fetchAllPages', () => {
  it('follows pagination until the last page (lists used to stop at the first 50/100 rows)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'))
      return new Response(JSON.stringify({ data: [page], pagination: { page, pages: 3 } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchAllPages<number>('/api/clients?archived=false')).toEqual([1, 2, 3])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/clients?archived=false&page=1&limit=100')
  })

  it('throws a readable error when a page fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Permission refusée' }), { status: 403 })))
    await expect(fetchAllPages('/api/users')).rejects.toThrow('Permission refusée')
  })
})
