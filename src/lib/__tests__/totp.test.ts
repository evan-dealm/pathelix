import { describe, it, expect } from 'vitest'
import { generateTotpSecret, totpCode, totpStep, totpUri, verifyTotp } from '../totp'

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (base32 below). The RFC lists
// 8-digit codes; a 6-digit code is their last six digits.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('totpCode — RFC 6238 vectors', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('at %i s gives %s', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(expected)
  })
})

describe('verifyTotp', () => {
  const nowMs = 1234567890 * 1000
  const step = totpStep(nowMs)

  it('accepts the current code and returns its step', () => {
    expect(verifyTotp(RFC_SECRET, '005924', { nowMs })).toBe(step)
  })

  it('tolerates spaces in the code', () => {
    expect(verifyTotp(RFC_SECRET, '005 924', { nowMs })).toBe(step)
  })

  it('accepts the previous and next step (clock drift)', () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), { nowMs })).toBe(step - 1)
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), { nowMs })).toBe(step + 1)
  })

  it('refuses a code two steps away', () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), { nowMs })).toBeNull()
  })

  it('refuses a code already used (replay)', () => {
    expect(verifyTotp(RFC_SECRET, '005924', { nowMs, lastStep: step })).toBeNull()
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), { nowMs, lastStep: step })).toBeNull()
  })

  it('refuses anything that is not six digits', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '00592a']) {
      expect(verifyTotp(RFC_SECRET, bad, { nowMs })).toBeNull()
    }
  })
})

describe('generateTotpSecret / totpUri', () => {
  it('generates distinct 32-character base32 secrets that verify their own codes', () => {
    const a = generateTotpSecret()
    const b = generateTotpSecret()
    expect(a).toMatch(/^[A-Z2-7]{32}$/)
    expect(a).not.toBe(b)
    const nowMs = Date.now()
    expect(verifyTotp(a, totpCode(a, totpStep(nowMs)), { nowMs })).toBe(totpStep(nowMs))
  })

  it('builds an otpauth URI carrying the secret, the account and the issuer', () => {
    const uri = totpUri(RFC_SECRET, 'sa@example.com')
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri).toContain(`secret=${RFC_SECRET}`)
    expect(uri).toContain(encodeURIComponent('sa@example.com'))
    expect(uri).toContain('digits=6')
  })
})
