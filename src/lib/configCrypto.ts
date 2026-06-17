import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

interface EncryptedConfig {
  v: 1
  iv: string
  tag: string
  data: string
}

function isEncryptedConfig(val: unknown): val is EncryptedConfig {
  if (typeof val !== 'object' || val === null) return false
  const e = val as Record<string, unknown>
  return e.v === 1
    && typeof e.iv === 'string'
    && typeof e.tag === 'string'
    && typeof e.data === 'string'
}

function getKey(): Buffer {
  const hex = process.env.INTEGRATION_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

export function encryptConfig(plain: Record<string, unknown>): EncryptedConfig {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()])
  return {
    v: 1,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: enc.toString('hex'),
  }
}

/** Decrypt an encrypted config. Passes through legacy plaintext configs transparently. */
export function decryptConfig(val: unknown): Record<string, unknown> {
  if (!isEncryptedConfig(val)) {
    return typeof val === 'object' && val !== null ? (val as Record<string, unknown>) : {}
  }
  const key = getKey()
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(val.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(val.tag, 'hex'))
  const plain = Buffer.concat([decipher.update(Buffer.from(val.data, 'hex')), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as Record<string, unknown>
}
