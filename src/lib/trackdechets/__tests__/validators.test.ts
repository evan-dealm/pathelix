import { describe, it, expect } from 'vitest'
import { BsddCreateSchema, BsddSignSchema, AccountCreateSchema } from '../validators'

const validCompany = {
  siret:   '12345678901234',
  name:    'Société Test',
  address: '1 rue de la Paix, 75001 Paris',
}

const validEmitter = { company: validCompany }

const validRecipient = {
  processingOperation: 'D9',
  company: validCompany,
}

const validWasteDetails = { code: '17 09 04' }

const minimalBsdd = {
  emitter:      validEmitter,
  recipient:    validRecipient,
  wasteDetails: validWasteDetails,
}

describe('BsddCreateSchema', () => {
  it('accepts minimal valid payload', () => {
    expect(BsddCreateSchema.safeParse(minimalBsdd).success).toBe(true)
  })

  it('accepts full payload with all optional fields', () => {
    const full = {
      missionId: 'mission-1',
      emitter: {
        type: 'PRODUCER',
        company: { ...validCompany, contact: 'Jean', phone: '0600000000', mail: 'j@example.com' },
        workSite: { name: 'Chantier', address: '2 av.', city: 'Lyon', postalCode: '69001', infos: 'RAS' },
      },
      recipient: {
        processingOperation: 'R1',
        company: validCompany,
        isTempStorage: false,
      },
      transporter: {
        company: validCompany,
        isExemptedOfReceipt: false,
        receipt: 'RECEPT-123',
        department: '75',
        validityLimit: '2026-12-31',
        numberPlate: 'AB-123-CD',
      },
      wasteDetails: {
        code:          '17 09 04',
        name:          'Déchets',
        onuCode:       'UN 1234',
        quantity:      1.5,
        quantityType:  'REAL',
        consistence:   'SOLID',
        packagingInfos: [{ type: 'BENNE', quantity: 1 }],
      },
    }
    expect(BsddCreateSchema.safeParse(full).success).toBe(true)
  })

  it('rejects missing emitter', () => {
    const { emitter: _, ...bad } = minimalBsdd as Record<string, unknown>
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects missing recipient', () => {
    const { recipient: _, ...bad } = minimalBsdd as Record<string, unknown>
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects missing wasteDetails', () => {
    const { wasteDetails: _, ...bad } = minimalBsdd as Record<string, unknown>
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects invalid SIRET (not 14 digits)', () => {
    const bad = { ...minimalBsdd, emitter: { company: { ...validCompany, siret: '1234' } } }
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects non-digit SIRET', () => {
    const bad = { ...minimalBsdd, emitter: { company: { ...validCompany, siret: 'ABCDEFGHIJKLMN' } } }
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects invalid processingOperation (no D/R prefix)', () => {
    const bad = { ...minimalBsdd, recipient: { processingOperation: 'X9', company: validCompany } }
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects invalid processingOperation (missing number)', () => {
    const bad = { ...minimalBsdd, recipient: { processingOperation: 'D', company: validCompany } }
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects invalid email in company.mail', () => {
    const bad = {
      ...minimalBsdd,
      emitter: { company: { ...validCompany, mail: 'not-an-email' } },
    }
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('accepts empty string for company.mail', () => {
    const ok = { ...minimalBsdd, emitter: { company: { ...validCompany, mail: '' } } }
    expect(BsddCreateSchema.safeParse(ok).success).toBe(true)
  })

  it('rejects wasteDetails with empty code', () => {
    const bad = { ...minimalBsdd, wasteDetails: { code: '' } }
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects negative quantity', () => {
    const bad = { ...minimalBsdd, wasteDetails: { code: '17 09 04', quantity: -1 } }
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects invalid consistence enum', () => {
    const bad = { ...minimalBsdd, wasteDetails: { code: '17 09 04', consistence: 'FOO' } }
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects transporter department with wrong format', () => {
    const bad = {
      ...minimalBsdd,
      transporter: { company: validCompany, department: '7' },
    }
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects invalid emitter type', () => {
    const bad = { ...minimalBsdd, emitter: { type: 'UNKNOWN', company: validCompany } }
    expect(BsddCreateSchema.safeParse(bad).success).toBe(false)
  })
})

describe('BsddSignSchema', () => {
  it('accepts PRODUCER signature', () => {
    const ok = { signatureType: 'PRODUCER', signatureAuthor: 'Jean Dupont' }
    expect(BsddSignSchema.safeParse(ok).success).toBe(true)
  })

  it('accepts TRANSPORTER signature with date', () => {
    const ok = { signatureType: 'TRANSPORTER', signatureAuthor: 'Marie Curie', signatureDate: '2026-06-01' }
    expect(BsddSignSchema.safeParse(ok).success).toBe(true)
  })

  it('rejects empty signatureAuthor', () => {
    const bad = { signatureType: 'PRODUCER', signatureAuthor: '' }
    expect(BsddSignSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects invalid signatureType', () => {
    const bad = { signatureType: 'ADMIN', signatureAuthor: 'Jean' }
    expect(BsddSignSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects missing signatureType', () => {
    const bad = { signatureAuthor: 'Jean' }
    expect(BsddSignSchema.safeParse(bad).success).toBe(false)
  })
})

describe('AccountCreateSchema', () => {
  it('accepts token >= 20 chars', () => {
    expect(AccountCreateSchema.safeParse({ token: 'a'.repeat(20) }).success).toBe(true)
  })

  it('rejects token < 20 chars', () => {
    expect(AccountCreateSchema.safeParse({ token: 'short' }).success).toBe(false)
  })

  it('rejects missing token', () => {
    expect(AccountCreateSchema.safeParse({}).success).toBe(false)
  })
})
