import { describe, it, expect, vi } from 'vitest'
import {
  validatePayloadForProducerSign,
  validatePayloadForTransporterSign,
} from '../bsdService'

vi.mock('../client', () => ({ callTdGraphQL: vi.fn(), TdApiError: class extends Error {} }))
vi.mock('../crypto', () => ({ decryptToken: vi.fn() }))

const fullPayload = {
  emitter:      { company: { siret: '12345678901234', name: 'Sté', address: '1 rue' } },
  recipient:    { processingOperation: 'D9', company: { siret: '12345678901234', name: 'Centre', address: '2 av' } },
  wasteDetails: { code: '17 09 04', name: 'Gravats', quantity: 2.5 },
  transporter: {
    company:       { siret: '12345678901234', name: 'Transport', address: '3 bd' },
    receipt:       'REC-75-001',
    department:    '75',
    validityLimit: '2027-06-01',
  },
}

describe('validatePayloadForProducerSign', () => {
  it('returns no errors for complete payload', () => {
    expect(validatePayloadForProducerSign(fullPayload)).toHaveLength(0)
  })

  it('requires wasteDetails.name', () => {
    const bad = { ...fullPayload, wasteDetails: { code: '17 09 04', quantity: 1 } }
    const errors = validatePayloadForProducerSign(bad)
    expect(errors.some(e => e.includes('wasteDetails.name'))).toBe(true)
  })

  it('requires wasteDetails.quantity', () => {
    const bad = { ...fullPayload, wasteDetails: { code: '17 09 04', name: 'Gravats' } }
    const errors = validatePayloadForProducerSign(bad)
    expect(errors.some(e => e.includes('wasteDetails.quantity'))).toBe(true)
  })

  it('rejects empty wasteDetails.name', () => {
    const bad = { ...fullPayload, wasteDetails: { code: '17 09 04', name: '', quantity: 2 } }
    const errors = validatePayloadForProducerSign(bad)
    expect(errors.some(e => e.includes('wasteDetails.name'))).toBe(true)
  })

  it('rejects null payload', () => {
    const errors = validatePayloadForProducerSign(null)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('returns all missing fields at once', () => {
    const bad = { ...fullPayload, wasteDetails: { code: '17 09 04' } }
    const errors = validatePayloadForProducerSign(bad)
    expect(errors.length).toBe(2)
  })
})

describe('validatePayloadForTransporterSign', () => {
  it('returns no errors for complete payload', () => {
    expect(validatePayloadForTransporterSign(fullPayload)).toHaveLength(0)
  })

  it('requires transporter block', () => {
    const { transporter: _, ...bad } = fullPayload as Record<string, unknown>
    const errors = validatePayloadForTransporterSign(bad)
    expect(errors.some(e => e.includes('transporter'))).toBe(true)
  })

  it('requires transporter.receipt', () => {
    const bad = { ...fullPayload, transporter: { ...fullPayload.transporter, receipt: '' } }
    const errors = validatePayloadForTransporterSign(bad)
    expect(errors.some(e => e.includes('transporter.receipt'))).toBe(true)
  })

  it('requires transporter.department', () => {
    const bad = { ...fullPayload, transporter: { ...fullPayload.transporter, department: '' } }
    const errors = validatePayloadForTransporterSign(bad)
    expect(errors.some(e => e.includes('transporter.department'))).toBe(true)
  })

  it('requires transporter.validityLimit', () => {
    const bad = { ...fullPayload, transporter: { ...fullPayload.transporter, validityLimit: '' } }
    const errors = validatePayloadForTransporterSign(bad)
    expect(errors.some(e => e.includes('transporter.validityLimit'))).toBe(true)
  })

  it('returns all missing fields at once', () => {
    const bad = {
      ...fullPayload,
      transporter: { company: fullPayload.transporter.company },
    }
    const errors = validatePayloadForTransporterSign(bad)
    expect(errors.length).toBe(3)
  })
})
