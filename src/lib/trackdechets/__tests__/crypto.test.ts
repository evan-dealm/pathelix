import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { encryptToken, decryptToken, verifyHmacSignature } from '../crypto'

const FAKE_KEY = 'a'.repeat(64)

beforeEach(() => {
  vi.stubEnv('TRACKDECHETS_ENCRYPTION_KEY', FAKE_KEY)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('encryptToken / decryptToken', () => {
  it('round-trips a plain token', () => {
    const { encryptedToken, iv, keyVersion } = encryptToken('my-secret-bearer-token')
    expect(encryptedToken).toBeTypeOf('string')
    expect(iv).toHaveLength(24) // 12 bytes hex
    expect(keyVersion).toBe(1)
    const plain = decryptToken({ encryptedToken, iv, keyVersion })
    expect(plain).toBe('my-secret-bearer-token')
  })

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const a = encryptToken('token-abc')
    const b = encryptToken('token-abc')
    expect(a.iv).not.toBe(b.iv)
    expect(a.encryptedToken).not.toBe(b.encryptedToken)
  })

  it('preserves keyVersion', () => {
    const { keyVersion } = encryptToken('tok', 3)
    expect(keyVersion).toBe(3)
  })

  it('throws on wrong key during decrypt', () => {
    const payload = encryptToken('secret')
    vi.stubEnv('TRACKDECHETS_ENCRYPTION_KEY', 'b'.repeat(64))
    expect(() => decryptToken(payload)).toThrow()
  })

  it('throws on tampered ciphertext', () => {
    // Flip the last hex digit deterministically (encryptedToken is hex, alphabet 0-9a-f).
    // A frequency-based replace (e.g. every 'a' -> 'b') is flaky: for a short plaintext the
    // ~44-char hex string has a real chance (~6%) of containing zero 'a's, in which case the
    // "tampered" payload is byte-identical to the original and decrypts successfully — flaking
    // this assertion. Flipping a fixed position always produces a different string.
    const payload = encryptToken('secret')
    const last = payload.encryptedToken.at(-1)
    const flipped = last === '0' ? '1' : '0'
    const tampered = { ...payload, encryptedToken: payload.encryptedToken.slice(0, -1) + flipped }
    expect(() => decryptToken(tampered)).toThrow()
  })

  it('throws when TRACKDECHETS_ENCRYPTION_KEY missing', () => {
    vi.stubEnv('TRACKDECHETS_ENCRYPTION_KEY', '')
    expect(() => encryptToken('x')).toThrow(/TRACKDECHETS_ENCRYPTION_KEY/)
  })

  it('throws when key is wrong length', () => {
    vi.stubEnv('TRACKDECHETS_ENCRYPTION_KEY', 'tooshort')
    expect(() => encryptToken('x')).toThrow(/TRACKDECHETS_ENCRYPTION_KEY/)
  })

  it('falls back to empty string when TRACKDECHETS_ENCRYPTION_KEY is absent', () => {
    // Covers the ?? '' branch when env var is undefined (not just empty string)
    const orig = process.env.TRACKDECHETS_ENCRYPTION_KEY
    delete process.env.TRACKDECHETS_ENCRYPTION_KEY
    try {
      expect(() => encryptToken('x')).toThrow(/TRACKDECHETS_ENCRYPTION_KEY/)
    } finally {
      if (orig !== undefined) process.env.TRACKDECHETS_ENCRYPTION_KEY = orig
    }
  })
})

describe('verifyHmacSignature', () => {
  const secret = 'my-webhook-secret'

  it('accepts valid sha256 signature', () => {
    const body = JSON.stringify({ type: 'BSD_STATUS_UPDATED' })
    const sig  = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect(verifyHmacSignature(body, sig, secret)).toBe(true)
  })

  it('rejects wrong signature', () => {
    const body = JSON.stringify({ type: 'test' })
    expect(verifyHmacSignature(body, 'sha256=abc123', secret)).toBe(false)
  })

  it('rejects wrong-length signature', () => {
    expect(verifyHmacSignature('body', 'short', secret)).toBe(false)
  })

  it('rejects empty signature', () => {
    expect(verifyHmacSignature('body', '', secret)).toBe(false)
  })

  it('returns false when multibyte signature causes timingSafeEqual to throw', () => {
    // Build a string with the same JS .length as expected (71 chars: sha256= + 64 hex)
    // but whose UTF-8 byte length differs because 'é' encodes as 2 bytes.
    // This bypasses the length-equality guard and triggers the catch branch.
    const body      = 'test'
    const expected  = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    const multiSig  = 'é' + 'x'.repeat(expected.length - 1) // same .length, more bytes
    expect(multiSig.length).toBe(expected.length)
    expect(verifyHmacSignature(body, multiSig, secret)).toBe(false)
  })
})
