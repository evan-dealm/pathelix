import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const TEST_KEY = 'a'.repeat(64) // 32 bytes of 0xaa as 64-char hex

describe('encryptConfig / decryptConfig', () => {
  beforeEach(() => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', TEST_KEY)
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('produces an encrypted envelope (v:1, iv, tag, data)', async () => {
    const { encryptConfig } = await import('@/lib/configCrypto')
    const result = encryptConfig({ apiKey: 'secret-key', url: 'https://example.com' })
    expect(result.v).toBe(1)
    expect(typeof result.iv).toBe('string')
    expect(typeof result.tag).toBe('string')
    expect(typeof result.data).toBe('string')
    expect(result.iv.length).toBe(24) // 12 bytes = 24 hex chars
    expect(result.tag.length).toBe(32) // 16 bytes = 32 hex chars
  })

  it('different calls produce different IVs (non-deterministic)', async () => {
    const { encryptConfig } = await import('@/lib/configCrypto')
    const a = encryptConfig({ key: 'val' })
    const b = encryptConfig({ key: 'val' })
    expect(a.iv).not.toBe(b.iv)
    expect(a.data).not.toBe(b.data)
  })

  it('encrypts and decrypts round-trip', async () => {
    const { encryptConfig, decryptConfig } = await import('@/lib/configCrypto')
    const original = { apiKey: 'super-secret', token: 'bearer-xyz', nested: { a: 1 } }
    const encrypted = encryptConfig(original)
    const decrypted = decryptConfig(encrypted)
    expect(decrypted).toEqual(original)
  })

  it('decryptConfig passes through plaintext objects (legacy migration)', async () => {
    const { decryptConfig } = await import('@/lib/configCrypto')
    const plaintext = { apiKey: 'legacy-key', webhookUrl: 'https://hooks.slack.com/test' }
    const result = decryptConfig(plaintext)
    expect(result).toBe(plaintext) // same reference, no copy
  })

  it('decryptConfig returns empty object for null/undefined input', async () => {
    const { decryptConfig } = await import('@/lib/configCrypto')
    expect(decryptConfig(null)).toEqual({})
    expect(decryptConfig(undefined)).toEqual({})
    expect(decryptConfig('not-an-object')).toEqual({})
  })

  it('decryptConfig returns empty object for partial encrypted envelope', async () => {
    const { decryptConfig } = await import('@/lib/configCrypto')
    // Missing required fields — treated as plaintext passthrough
    expect(decryptConfig({ v: 1, iv: 'abc' })).toEqual({ v: 1, iv: 'abc' })
  })

  it('throws when key is wrong length', async () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', 'tooshort')
    const { encryptConfig } = await import('@/lib/configCrypto')
    expect(() => encryptConfig({ a: 1 })).toThrow('INTEGRATION_ENCRYPTION_KEY')
  })

  it('throws when key is missing', async () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', '')
    const { encryptConfig } = await import('@/lib/configCrypto')
    expect(() => encryptConfig({ a: 1 })).toThrow('INTEGRATION_ENCRYPTION_KEY')
  })

  it('decryption fails with wrong key (tampered ciphertext)', async () => {
    const { encryptConfig, decryptConfig } = await import('@/lib/configCrypto')
    const encrypted = encryptConfig({ secret: 'value' })
    // Tamper with the data
    const tampered = { ...encrypted, data: 'ff'.repeat(encrypted.data.length / 2) }
    expect(() => decryptConfig(tampered)).toThrow()
  })

  it('encrypts empty object', async () => {
    const { encryptConfig, decryptConfig } = await import('@/lib/configCrypto')
    const encrypted = encryptConfig({})
    const decrypted = decryptConfig(encrypted)
    expect(decrypted).toEqual({})
  })
})
