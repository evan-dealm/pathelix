import { randomBytes } from 'crypto'

/** Opaque token printed in a bin's QR code (never the database id, never guessable). */
export function newQrToken(): string {
  return randomBytes(16).toString('base64url')
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Next fleet numbers for a prefix: B-00001, B-00002… after the highest existing one. */
export function nextNumbers(existing: string[], prefix: string, count: number): string[] {
  const re = new RegExp(`^${escapeRe(prefix)}(\\d+)$`)
  let max = 0
  let width = 5
  for (const n of existing) {
    const m = re.exec(n)
    if (m) { max = Math.max(max, parseInt(m[1], 10)); width = Math.max(width, m[1].length) }
  }
  return Array.from({ length: count }, (_, i) => `${prefix}${String(max + 1 + i).padStart(width, '0')}`)
}
