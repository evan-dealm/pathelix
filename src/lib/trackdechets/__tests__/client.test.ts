import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callTdGraphQL, TdApiError, TdHaltError } from '../client'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

function makeResponse(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('callTdGraphQL', () => {
  it('returns data on successful GraphQL response', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ data: { form: { id: 'td-1', status: 'DRAFT' } } }))

    const result = await callTdGraphQL<{ form: { id: string; status: string } }>(
      'token-xyz',
      '{ form { id status } }',
    )
    expect(result).toEqual({ form: { id: 'td-1', status: 'DRAFT' } })
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(opts.headers).toMatchObject({ Authorization: 'Bearer token-xyz' })
    expect(url).toContain('trackdechets')
  })

  it('passes variables to fetch body', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ data: { createForm: { id: 'td-new' } } }))

    await callTdGraphQL('token', 'mutation($id: ID!){ createForm(id: $id) { id } }', { id: 'abc' })
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.variables).toEqual({ id: 'abc' })
  })

  it('throws TdApiError on HTTP non-OK status', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    )

    await expect(callTdGraphQL('bad-token', '{ form }'))
      .rejects.toThrowError(TdApiError)
  })

  it('HTTP error TdApiError has correct statusCode', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    try {
      await callTdGraphQL('token', '{ form }')
      expect.fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(TdApiError)
      expect((err as TdApiError).statusCode).toBe(403)
    }
  })

  it('throws TdApiError on GraphQL errors array', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      errors: [{ message: 'Acteur non inscrit sur Trackdéchets' }],
    }))

    await expect(callTdGraphQL('token', '{ form }'))
      .rejects.toThrowError('Acteur non inscrit sur Trackdéchets')
  })

  it('TdApiError from GraphQL errors has errors array populated', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      errors: [{ message: 'E1' }, { message: 'E2' }],
    }))

    try {
      await callTdGraphQL('token', '{ form }')
      expect.fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(TdApiError)
      expect((err as TdApiError).errors).toHaveLength(2)
      expect((err as TdApiError).errors[0].message).toBe('E1')
    }
  })

  it('throws TdApiError when data is missing from response', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ errors: null }))

    await expect(callTdGraphQL('token', '{ form }'))
      .rejects.toThrowError(TdApiError)
  })

  it('throws TdApiError on timeout (AbortError)', async () => {
    mockFetch.mockImplementationOnce(() => {
      const err = new Error('The user aborted a request.')
      err.name = 'AbortError'
      return Promise.reject(err)
    })

    const result = callTdGraphQL('token', '{ form }', undefined, 50)
    await expect(result).rejects.toThrowError('Timeout')
  })

  it('re-throws non-AbortError network errors as-is', async () => {
    const networkError = new Error('Network failure')
    mockFetch.mockRejectedValueOnce(networkError)

    await expect(callTdGraphQL('token', '{ form }'))
      .rejects.toThrow('Network failure')
  })

  it('uses TRACKDECHETS_API_URL env when set', async () => {
    vi.stubEnv('TRACKDECHETS_API_URL', 'https://custom.td.example.com/')
    mockFetch.mockResolvedValueOnce(makeResponse({ data: {} }))

    await callTdGraphQL('token', '{ form }')
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://custom.td.example.com/')

    vi.unstubAllEnvs()
  })

  it('uses fetch with POST method and JSON body', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ data: { x: 1 } }))

    await callTdGraphQL('token', 'query { x }', { param: 42 })
    const opts = (mockFetch.mock.calls[0] as [string, RequestInit])[1]
    expect(opts.method).toBe('POST')
    expect(opts.headers).toMatchObject({ 'Content-Type': 'application/json' })
    const body = JSON.parse(opts.body as string)
    expect(body.query).toBe('query { x }')
    expect(body.variables).toEqual({ param: 42 })
  })
})

describe('HALT Trackdéchets — TRACKDECHETS_API_URL de production', () => {
  it('blocks the call with TdHaltError when pointed at production without the lift flag', async () => {
    vi.stubEnv('TRACKDECHETS_API_URL', 'https://api.trackdechets.beta.gouv.fr/')
    vi.stubEnv('TRACKDECHETS_HALT_LIFTED', '')

    await expect(callTdGraphQL('token', '{ form }')).rejects.toThrowError(TdHaltError)
    expect(mockFetch).not.toHaveBeenCalled()

    vi.unstubAllEnvs()
  })

  it('allows the call when TRACKDECHETS_HALT_LIFTED=true', async () => {
    vi.stubEnv('TRACKDECHETS_API_URL', 'https://api.trackdechets.beta.gouv.fr/')
    vi.stubEnv('TRACKDECHETS_HALT_LIFTED', 'true')
    mockFetch.mockResolvedValueOnce(makeResponse({ data: { x: 1 } }))

    await expect(callTdGraphQL('token', '{ form }')).resolves.toEqual({ x: 1 })
    expect(mockFetch).toHaveBeenCalledOnce()

    vi.unstubAllEnvs()
  })

  it('never blocks the sandbox URL, lift flag or not', async () => {
    vi.stubEnv('TRACKDECHETS_API_URL', 'https://sandbox.trackdechets.beta.gouv.fr/')
    vi.stubEnv('TRACKDECHETS_HALT_LIFTED', '')
    mockFetch.mockResolvedValueOnce(makeResponse({ data: { x: 1 } }))

    await expect(callTdGraphQL('token', '{ form }')).resolves.toEqual({ x: 1 })

    vi.unstubAllEnvs()
  })
})

describe('TdApiError', () => {
  it('has correct name and message', () => {
    const err = new TdApiError('test error', [{ message: 'detail' }], 400)
    expect(err.name).toBe('TdApiError')
    expect(err.message).toBe('test error')
    expect(err.statusCode).toBe(400)
    expect(err.errors).toEqual([{ message: 'detail' }])
  })

  it('instanceof Error', () => {
    const err = new TdApiError('msg', [])
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(TdApiError)
  })

  it('statusCode is optional', () => {
    const err = new TdApiError('msg', [])
    expect(err.statusCode).toBeUndefined()
  })
})
