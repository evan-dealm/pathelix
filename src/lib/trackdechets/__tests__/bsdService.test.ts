import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TdApiError } from '../client'

vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()
  return {
    ...actual,
    callTdGraphQL: vi.fn(),
  }
})

vi.mock('../crypto', () => ({
  decryptToken: vi.fn(() => 'plain-bearer-token'),
  encryptToken: vi.fn(() => ({ encryptedToken: 'enc', iv: 'iv', keyVersion: 1 })),
}))

import { callTdGraphQL } from '../client'
import {
  createBsddInTd,
  sealBsddInTd,
  signBsddInTd,
  fetchBsddStatusFromTd,
  getTokenFromAccount,
  mapTdStatus,
} from '../bsdService'

const mockCall = vi.mocked(callTdGraphQL)

const TOKEN = 'plain-bearer-token'

const company = {
  siret:   '12345678901234',
  name:    'Société',
  address: '1 rue test',
}

const minimalInput = {
  emitter:      { company },
  recipient:    { processingOperation: 'D9', company },
  wasteDetails: { code: '17 09 04' },
}

beforeEach(() => {
  mockCall.mockReset()
})

describe('mapTdStatus', () => {
  it('maps known statuses', () => {
    expect(mapTdStatus('DRAFT')).toBe('DRAFT')
    expect(mapTdStatus('SEALED')).toBe('SEALED')
    expect(mapTdStatus('SENT')).toBe('SENT')
    expect(mapTdStatus('PROCESSED')).toBe('PROCESSED')
    expect(mapTdStatus('SIGNED_BY_PRODUCER')).toBe('SIGNED_BY_PRODUCER')
    expect(mapTdStatus('SIGNED_BY_TRANSPORTER')).toBe('SIGNED_BY_TRANSPORTER')
  })

  it('falls back to DRAFT for unknown status', () => {
    expect(mapTdStatus('TOTALLY_UNKNOWN')).toBe('DRAFT')
    expect(mapTdStatus('')).toBe('DRAFT')
  })
})

describe('createBsddInTd', () => {
  it('calls callTdGraphQL and returns saveForm result', async () => {
    const tdForm = { id: 'td-abc', status: 'DRAFT', readableId: 'TD-26-AAA-00001' }
    mockCall.mockResolvedValueOnce({ saveForm: tdForm })

    const result = await createBsddInTd(TOKEN, minimalInput)

    expect(mockCall).toHaveBeenCalledOnce()
    expect(mockCall.mock.calls[0][0]).toBe(TOKEN)
    expect(mockCall.mock.calls[0][1]).toContain('saveForm')
    expect(result).toEqual(tdForm)
  })

  it('propagates TdApiError', async () => {
    mockCall.mockRejectedValueOnce(new TdApiError('GraphQL error', [{ message: 'SIRET invalide' }]))
    await expect(createBsddInTd(TOKEN, minimalInput)).rejects.toBeInstanceOf(TdApiError)
  })
})

describe('sealBsddInTd', () => {
  it('calls markAsSealed mutation and returns result', async () => {
    const tdForm = { id: 'td-abc', status: 'SEALED', readableId: 'TD-26-AAA-00001' }
    mockCall.mockResolvedValueOnce({ markAsSealed: tdForm })

    const result = await sealBsddInTd(TOKEN, 'td-abc')

    expect(mockCall).toHaveBeenCalledOnce()
    expect(mockCall.mock.calls[0][1]).toContain('markAsSealed')
    expect(result.status).toBe('SEALED')
  })
})

describe('signBsddInTd', () => {
  it('calls signedByProducer when signatureType=PRODUCER', async () => {
    const tdForm = { id: 'td-abc', status: 'SIGNED_BY_PRODUCER', readableId: '' }
    mockCall.mockResolvedValueOnce({ signedByProducer: tdForm })

    const result = await signBsddInTd(TOKEN, 'td-abc', {
      signatureType: 'PRODUCER',
      signatureAuthor: 'Jean Dupont',
    })

    expect(mockCall.mock.calls[0][1]).toContain('signedByProducer')
    expect(result.status).toBe('SIGNED_BY_PRODUCER')
  })

  it('calls signedByTransporter when signatureType=TRANSPORTER', async () => {
    const tdForm = { id: 'td-abc', status: 'SIGNED_BY_TRANSPORTER', readableId: '' }
    mockCall.mockResolvedValueOnce({ signedByTransporter: tdForm })

    const result = await signBsddInTd(TOKEN, 'td-abc', {
      signatureType: 'TRANSPORTER',
      signatureAuthor: 'Marie Martin',
    })

    expect(mockCall.mock.calls[0][1]).toContain('signedByTransporter')
    expect(result.status).toBe('SIGNED_BY_TRANSPORTER')
  })

  it('uses provided signatureDate', async () => {
    mockCall.mockResolvedValueOnce({ signedByProducer: { id: 'x', status: 'SIGNED_BY_PRODUCER', readableId: '' } })

    await signBsddInTd(TOKEN, 'td-abc', {
      signatureType: 'PRODUCER',
      signatureAuthor: 'Jean',
      signatureDate: '2026-06-01T10:00:00Z',
    })

    const variables = mockCall.mock.calls[0][2] as Record<string, unknown>
    const signingInfo = variables.signingInfo as Record<string, unknown>
    expect(signingInfo.sentAt).toBe('2026-06-01T10:00:00Z')
  })

  it('generates ISO date when signatureDate absent', async () => {
    mockCall.mockResolvedValueOnce({ signedByProducer: { id: 'x', status: 'SIGNED_BY_PRODUCER', readableId: '' } })

    await signBsddInTd(TOKEN, 'td-abc', {
      signatureType: 'PRODUCER',
      signatureAuthor: 'Jean',
    })

    const variables = mockCall.mock.calls[0][2] as Record<string, unknown>
    const signingInfo = variables.signingInfo as Record<string, unknown>
    expect(typeof signingInfo.sentAt).toBe('string')
    expect(new Date(signingInfo.sentAt as string).getTime()).not.toBeNaN()
  })
})

describe('fetchBsddStatusFromTd', () => {
  it('calls GetForm query and returns form', async () => {
    const form = { id: 'td-abc', status: 'RECEIVED', readableId: 'TD-26-AAA-00001' }
    mockCall.mockResolvedValueOnce({ form })

    const result = await fetchBsddStatusFromTd(TOKEN, 'td-abc')

    expect(mockCall.mock.calls[0][1]).toContain('GetForm')
    expect(result.status).toBe('RECEIVED')
  })
})

describe('getTokenFromAccount', () => {
  it('decrypts account token via decryptToken', () => {
    const account = { encryptedToken: 'enc', iv: 'iv', keyVersion: 1 }
    const token = getTokenFromAccount(account)
    expect(token).toBe('plain-bearer-token')
  })
})
