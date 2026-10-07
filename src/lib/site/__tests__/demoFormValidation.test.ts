import { describe, it, expect } from 'vitest'
import { validateDemoForm } from '@/lib/site/demoFormValidation'
import { DemoRequestSchema } from '@/lib/site/demoRequest'

const VALID = {
  firstName: 'Camille',
  lastName: 'Martin',
  company: 'Bennes du Lac',
  email: 'camille.martin@bennes-du-lac.fr',
}

describe('demo form validation (browser side)', () => {
  it('accepts ordinary professional addresses — regression: every address containing an "s" was refused', () => {
    for (const email of [
      'essai-ui@example.com',
      'serge.masson@transports-savoie.fr',
      'contact@sas-recyclage.com',
      'a.b+demo@sub.domain.io',
    ]) {
      expect(validateDemoForm({ ...VALID, email }), email).toEqual({})
    }
  })

  it('names each missing required field', () => {
    expect(validateDemoForm({})).toEqual({
      firstName: 'Indiquez votre prénom',
      lastName: 'Indiquez votre nom',
      company: 'Indiquez votre entreprise',
      email: 'Indiquez votre e-mail',
    })
    expect(validateDemoForm({ ...VALID, company: '   ' })).toEqual({
      company: 'Indiquez votre entreprise',
    })
  })

  it('refuses what is not an address', () => {
    for (const email of [
      'camille',
      'camille@',
      '@example.com',
      'camille@example',
      'a b@example.com',
    ]) {
      expect(validateDemoForm({ ...VALID, email }).email, email).toBe('Adresse e-mail invalide')
    }
  })

  it('agrees with the server schema: what the form lets through, the route accepts, and conversely', () => {
    const cases = [
      VALID,
      { ...VALID, email: 'essai-ui@example.com' },
      { ...VALID, firstName: '' },
      { ...VALID, lastName: '  ' },
      { ...VALID, company: '' },
      { ...VALID, email: '' },
      { ...VALID, email: 'pas-un-email' },
      { ...VALID, email: 'camille@example' },
    ]
    for (const values of cases) {
      const formOk = Object.keys(validateDemoForm(values)).length === 0
      expect(DemoRequestSchema.safeParse(values).success, JSON.stringify(values)).toBe(formOk)
    }
  })
})
