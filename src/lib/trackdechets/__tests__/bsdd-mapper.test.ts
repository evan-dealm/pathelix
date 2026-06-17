import { describe, it, expect } from 'vitest'
import { bsddInputToTdFormInput } from '../mappers/bsdd'
import type { BsddCreateInput } from '../validators'

const company = {
  siret:   '12345678901234',
  name:    'Société A',
  address: '1 rue Test, 75001 Paris',
}

const minimal: BsddCreateInput = {
  emitter:      { company },
  recipient:    { processingOperation: 'D9', company },
  wasteDetails: { code: '17 09 04' },
}

describe('bsddInputToTdFormInput', () => {
  it('maps emitter company fields', () => {
    const out = bsddInputToTdFormInput(minimal)
    const emitter = out.emitter as Record<string, unknown>
    const co = emitter.company as Record<string, unknown>
    expect(co.siret).toBe('12345678901234')
    expect(co.name).toBe('Société A')
    expect(co.address).toBe('1 rue Test, 75001 Paris')
  })

  it('defaults emitter.type to PRODUCER when absent', () => {
    const out = bsddInputToTdFormInput(minimal)
    const emitter = out.emitter as Record<string, unknown>
    expect(emitter.type).toBe('PRODUCER')
  })

  it('uses emitter.type when provided', () => {
    const input: BsddCreateInput = { ...minimal, emitter: { ...minimal.emitter, type: 'OTHER' } }
    const out = bsddInputToTdFormInput(input)
    const emitter = out.emitter as Record<string, unknown>
    expect(emitter.type).toBe('OTHER')
  })

  it('includes workSite when provided', () => {
    const input: BsddCreateInput = {
      ...minimal,
      emitter: { company, workSite: { name: 'Chantier', city: 'Lyon' } },
    }
    const out = bsddInputToTdFormInput(input)
    const emitter = out.emitter as Record<string, unknown>
    expect(emitter.workSite).toEqual({ name: 'Chantier', city: 'Lyon' })
  })

  it('omits workSite key when not provided', () => {
    const out = bsddInputToTdFormInput(minimal)
    const emitter = out.emitter as Record<string, unknown>
    expect('workSite' in emitter).toBe(false)
  })

  it('maps recipient.processingOperation', () => {
    const out = bsddInputToTdFormInput(minimal)
    const recipient = out.recipient as Record<string, unknown>
    expect(recipient.processingOperation).toBe('D9')
  })

  it('includes isTempStorage when provided', () => {
    const input: BsddCreateInput = {
      ...minimal,
      recipient: { processingOperation: 'D9', company, isTempStorage: true },
    }
    const out = bsddInputToTdFormInput(input)
    const recipient = out.recipient as Record<string, unknown>
    expect(recipient.isTempStorage).toBe(true)
  })

  it('omits isTempStorage when not provided', () => {
    const out = bsddInputToTdFormInput(minimal)
    const recipient = out.recipient as Record<string, unknown>
    expect('isTempStorage' in recipient).toBe(false)
  })

  it('defaults wasteDetails fields when optional absent', () => {
    const out = bsddInputToTdFormInput(minimal)
    const wd = out.wasteDetails as Record<string, unknown>
    expect(wd.code).toBe('17 09 04')
    expect(wd.name).toBe('')
    expect(wd.onuCode).toBe('')
    expect(wd.quantity).toBe(0)
    expect(wd.quantityType).toBe('ESTIMATED')
    expect(wd.consistence).toBe('SOLID')
    expect(wd.packagingInfos).toEqual([])
  })

  it('passes provided wasteDetails values through', () => {
    const input: BsddCreateInput = {
      ...minimal,
      wasteDetails: {
        code:          '17 09 04',
        name:          'Gravats',
        quantity:      3.5,
        quantityType:  'REAL',
        consistence:   'LIQUID',
        packagingInfos: [{ type: 'BENNE', quantity: 2 }],
      },
    }
    const out = bsddInputToTdFormInput(input)
    const wd = out.wasteDetails as Record<string, unknown>
    expect(wd.name).toBe('Gravats')
    expect(wd.quantity).toBe(3.5)
    expect(wd.quantityType).toBe('REAL')
    expect(wd.consistence).toBe('LIQUID')
    expect(wd.packagingInfos).toEqual([{ type: 'BENNE', quantity: 2 }])
  })

  it('includes transporter block when provided', () => {
    const input: BsddCreateInput = {
      ...minimal,
      transporter: { company, receipt: 'REC-001', department: '75' },
    }
    const out = bsddInputToTdFormInput(input)
    expect(out.transporter).toBeDefined()
    const tr = out.transporter as Record<string, unknown>
    expect((tr.company as Record<string, unknown>).siret).toBe('12345678901234')
    expect(tr.receipt).toBe('REC-001')
    expect(tr.department).toBe('75')
    expect(tr.isExemptedOfReceipt).toBe(false)
  })

  it('omits transporter key when not provided', () => {
    const out = bsddInputToTdFormInput(minimal)
    expect('transporter' in out).toBe(false)
  })

  it('defaults optional company fields to empty string', () => {
    const out = bsddInputToTdFormInput(minimal)
    const co = (out.emitter as Record<string, unknown>).company as Record<string, unknown>
    expect(co.contact).toBe('')
    expect(co.phone).toBe('')
    expect(co.mail).toBe('')
  })

  it('defaults optional transporter fields to empty string when absent', () => {
    // Covers ?? '' branches for receipt, department, validityLimit, numberPlate
    const input: BsddCreateInput = { ...minimal, transporter: { company } }
    const out = bsddInputToTdFormInput(input)
    const tr  = out.transporter as Record<string, unknown>
    expect(tr.receipt).toBe('')
    expect(tr.department).toBe('')
    expect(tr.validityLimit).toBe('')
    expect(tr.numberPlate).toBe('')
    expect(tr.isExemptedOfReceipt).toBe(false)
  })
})
