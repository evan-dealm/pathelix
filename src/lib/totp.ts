import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s) — the second factor of the
 * superadmin account. Compatible with the usual authenticator apps.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6

function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char)
    if (idx === -1) throw new Error('Invalid base32 secret')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
    value &= (1 << bits) - 1
  }
  return Buffer.from(bytes)
}

/** A new random secret (160 bits), base32-encoded as authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** The 30-second step a timestamp falls in. */
export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS)
}

/** The code valid during one step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = digest.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/**
 * Checks a code against the current step and its neighbours (clock drift of ±30 s). Returns the
 * matching step, or null. A step at or below `lastStep` never matches: a code that has already
 * been accepted cannot be replayed within its validity window.
 */
export function verifyTotp(
  secret: string,
  code: string,
  opts: { nowMs?: number; lastStep?: number | null } = {},
): number | null {
  const candidate = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(candidate)) return null
  const current = totpStep(opts.nowMs)
  for (const step of [current, current - 1, current + 1]) {
    if (typeof opts.lastStep === 'number' && step <= opts.lastStep) continue
    const expected = Buffer.from(totpCode(secret, step))
    if (timingSafeEqual(expected, Buffer.from(candidate))) return step
  }
  return null
}

/** The otpauth:// URI an authenticator app reads from a QR code. */
export function totpUri(secret: string, account: string, issuer = 'Pathélix'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
}
