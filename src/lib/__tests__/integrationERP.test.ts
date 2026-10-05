import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const mockFindMany = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({
    integration: {
      findMany: mockFindMany,
      update:   mockUpdate,
    },
  }),
}))
vi.mock('@/lib/outboundUrl', () => ({
  safeFetch: (url: string, init: RequestInit) => fetch(url, init),
}))

import { syncMissionToERP } from '../integrationERP'

const BASE_DATA = {
  tenantId:    't-1',
  missionId:   'm-1',
  missionType: 'RETIRER',
  clientName:  'Acme',
  clientId:    'c-1',
  date:        '2025-06-15',
  wasteType:   'DND',
  weightTons:  1.5,
  driverName:  'Jean',
  exutoire:    'Centre',
  durationMin: 60,
}

function mockFetch(ok = true, status = ok ? 200 : 500) {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok, status }),
  ))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({})
})

describe('syncMissionToERP — no integrations', () => {
  it('does nothing when no enabled integrations', async () => {
    mockFindMany.mockResolvedValue([])
    await expect(syncMissionToERP(BASE_DATA)).resolves.toBeUndefined()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('syncMissionToERP — Sage', () => {
  const sageInteg = {
    id:     'integ-1',
    type:   'sage',
    config: { apiKey: 'key-abc', companyId: 'comp-1' },
  }

  it('calls Sage API and updates lastSyncAt on success', async () => {
    mockFindMany.mockResolvedValue([sageInteg])
    mockFetch(true)
    await syncMissionToERP(BASE_DATA)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('sage.com'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'integ-1' },
        data: expect.objectContaining({ lastSyncAt: expect.any(Date), lastError: null }),
      }),
    )
  })

  it('sends correct payload to Sage', async () => {
    mockFindMany.mockResolvedValue([sageInteg])
    mockFetch(true)
    await syncMissionToERP(BASE_DATA)
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.type).toBe('service_invoice_line')
    expect(body.reference).toBe('m-1')
    expect(body.company_id).toBe('comp-1')
    expect(body.weight_tons).toBe(1.5)
  })

  it('uses clientName when clientId is absent', async () => {
    mockFindMany.mockResolvedValue([sageInteg])
    mockFetch(true)
    const data = { ...BASE_DATA, clientId: undefined }
    await syncMissionToERP(data)
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.customer_reference).toBe('Acme')
  })

  it('sets weight_tons to null when weightTons absent', async () => {
    mockFindMany.mockResolvedValue([sageInteg])
    mockFetch(true)
    const data = { ...BASE_DATA, weightTons: undefined }
    await syncMissionToERP(data)
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.weight_tons).toBeNull()
  })

  it('handles Sage API failure — updates lastError', async () => {
    mockFindMany.mockResolvedValue([sageInteg])
    mockFetch(false, 500)
    await syncMissionToERP(BASE_DATA)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'integ-1' },
        data: expect.objectContaining({ lastError: expect.stringContaining('500') }),
      }),
    )
  })

  it('handles missing apiKey — logs error', async () => {
    mockFindMany.mockResolvedValue([{ ...sageInteg, config: { companyId: 'x' } }])
    await syncMissionToERP(BASE_DATA)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastError: expect.stringContaining('Sage API key') }),
      }),
    )
  })
})

describe('syncMissionToERP — SAP', () => {
  const sapInteg = {
    id:     'integ-2',
    type:   'sap',
    config: { baseUrl: 'https://sap.example.com', clientId: 'cid', clientSecret: 'csec' },
  }

  it('calls SAP API and updates lastSyncAt on success', async () => {
    mockFindMany.mockResolvedValue([sapInteg])
    mockFetch(true)
    await syncMissionToERP(BASE_DATA)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('sap.example.com'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncAt: expect.any(Date), lastError: null }),
      }),
    )
  })

  it('sends correct payload to SAP', async () => {
    mockFindMany.mockResolvedValue([sapInteg])
    mockFetch(true)
    await syncMissionToERP(BASE_DATA)
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.DocType).toBe('dDocument_Service')
    expect(body.CardCode).toBe('c-1')
    expect(body.DocumentLines[0].Weight).toBe(1.5)
  })

  it('uses clientName when clientId absent in SAP', async () => {
    mockFindMany.mockResolvedValue([sapInteg])
    mockFetch(true)
    const data = { ...BASE_DATA, clientId: undefined }
    await syncMissionToERP(data)
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.CardCode).toBe('Acme')
  })

  it('handles SAP API failure — updates lastError', async () => {
    mockFindMany.mockResolvedValue([sapInteg])
    mockFetch(false, 503)
    await syncMissionToERP(BASE_DATA)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastError: expect.stringContaining('503') }),
      }),
    )
  })

  it('handles incomplete SAP config — logs error', async () => {
    mockFindMany.mockResolvedValue([{ ...sapInteg, config: { baseUrl: '' } }])
    await syncMissionToERP(BASE_DATA)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastError: expect.stringContaining('SAP config') }),
      }),
    )
  })
})

describe('syncMissionToERP — error handling', () => {
  it('does not throw when prisma.findMany throws', async () => {
    mockFindMany.mockRejectedValue(new Error('DB error'))
    await expect(syncMissionToERP(BASE_DATA)).resolves.toBeUndefined()
  })

  it('continues to next integration if one fails', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'integ-1', type: 'sage', config: {} }, // will fail (no apiKey)
      { id: 'integ-2', type: 'sap', config: { baseUrl: 'https://sap.x', clientId: 'c', clientSecret: 's' } },
    ])
    mockFetch(true)
    await syncMissionToERP(BASE_DATA)
    // Both updates called
    expect(mockUpdate).toHaveBeenCalledTimes(2)
  })

  it('handles update failure gracefully (swallowed)', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'integ-1', type: 'sage', config: {} }, // fails
    ])
    mockUpdate.mockRejectedValue(new Error('update failed'))
    await expect(syncMissionToERP(BASE_DATA)).resolves.toBeUndefined()
  })
})
