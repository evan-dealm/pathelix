import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { createLogger } from '@/lib/logger'

const log       = createLogger('trackdechets/crypto')
const ALGORITHM = 'aes-256-gcm' as const
const IV_BYTES  = 12
const TAG_BYTES = 16

export interface EncryptedPayload {
  encryptedToken: string
  iv:             string
  keyVersion:     number
}

function getKey(): Buffer {
  const raw = process.env.TRACKDECHETS_ENCRYPTION_KEY ?? ''
  if (raw.length !== 64) {
    throw new Error('TRACKDECHETS_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  }
  return Buffer.from(raw, 'hex')
}

export function encryptToken(plaintext: string, keyVersion = 1): EncryptedPayload {
  const key    = getKey()
  const iv     = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  return {
    encryptedToken: encrypted.toString('hex'),
    iv:             iv.toString('hex'),
    keyVersion,
  }
}

export function decryptToken(payload: EncryptedPayload): string {
  const key        = getKey()
  const iv         = Buffer.from(payload.iv, 'hex')
  const raw        = Buffer.from(payload.encryptedToken, 'hex')
  const authTag    = raw.subarray(raw.length - TAG_BYTES)
  const ciphertext = raw.subarray(0, raw.length - TAG_BYTES)
  const decipher   = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch (err) {
    log.error('Token decryption failed', { err: err instanceof Error ? err.message : String(err) })
    throw new Error('Déchiffrement du token Trackdéchets échoué')
  }
}

export function verifyHmacSignature(
  rawBody:   string,
  signature: string,
  secret:    string,
): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  if (signature.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}
