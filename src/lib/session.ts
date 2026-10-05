import { TENANT_ID_RE } from './data/context'

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error(
      '[session] SESSION_SECRET est requis. Définissez cette variable d\'environnement (min 32 chars).',
    )
  }
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error(
      '[session] SESSION_SECRET doit faire au moins 32 caractères en production.',
    )
  }
  return secret
}

export interface SessionPayload {
  sub:        string
  role:       'superadmin' | 'admin' | 'driver' | 'dispatcher'
  tenantId:   string
  driverRef?: string
  trade?:     string
  /** User.sessionVersion at sign time — the middleware rejects the token once the user's version moves on. */
  sv?:        number
  iat?:       number
  exp?:       number
}

export const SESSION_COOKIE = 'session'

const _revokedTenants = new Set<string>()

export function revokeSessionsForTenant(tenantId: string): void {
  _revokedTenants.add(tenantId)
}

export function unrevokeSessionsForTenant(tenantId: string): void {
  _revokedTenants.delete(tenantId)
}

export const COOKIE_OPTIONS = {
  httpOnly: true,

  get secure() {
    return process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS !== 'false'
  },
  sameSite: 'strict' as const,
  maxAge:   86400,
  path:     '/',
}

function b64urlEncode(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g,  '')
}

function b64urlDecode(str: string): string {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function b64urlToBytes(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4)
  const binary = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return new Uint8Array(binary)
}

let _cachedKey:    CryptoKey | null = null
let _cachedSecret: string  | null = null

async function getHmacKey(): Promise<CryptoKey> {
  const currentSecret = getSessionSecret()

  if (_cachedKey && _cachedSecret === currentSecret) return _cachedKey
  const keyData = new TextEncoder().encode(currentSecret)
  _cachedKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  _cachedSecret = currentSecret
  return _cachedKey
}

async function hmacSign(data: string): Promise<string> {
  const key = await getHmacKey()
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return Buffer.from(sig)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g,  '')
}

async function hmacVerify(data: string, signature: string): Promise<boolean> {
  const key      = await getHmacKey()
  const sigBytes = b64urlToBytes(signature)
  return crypto.subtle.verify('HMAC', key, sigBytes.buffer as ArrayBuffer, new TextEncoder().encode(data))
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const header  = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body    = b64urlEncode(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: payload.exp ?? Math.floor(Date.now() / 1000) + 86400,
  }))
  const signing = `${header}.${body}`
  const sig     = await hmacSign(signing)
  return `${signing}.${sig}`
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, body, signature] = parts
    const valid = await hmacVerify(`${header}.${body}`, signature)
    if (!valid) return null

    const raw = JSON.parse(b64urlDecode(body)) as Record<string, unknown>

    const VALID_ROLES = ['superadmin', 'admin', 'driver', 'dispatcher'] as const
    if (
      typeof raw.sub      !== 'string' || !raw.sub ||
      typeof raw.tenantId !== 'string' || !raw.tenantId ||
      !VALID_ROLES.includes(raw.role as typeof VALID_ROLES[number])
    ) return null

    // Legacy tracking links were signed with this same key (sub = "track:<missionId>") and so
    // verified as driver sessions. They are customer-facing — never a valid session.
    if ((raw.sub as string).startsWith('track:')) return null

    const tenantStr = raw.tenantId as string
    if (tenantStr.length > 64 || !TENANT_ID_RE.test(tenantStr)) return null

    const nowSec = Math.floor(Date.now() / 1000)
    const CLOCK_SKEW = 60
    // exp is mandatory: signSession always sets it, a token without one is never accepted.
    if (typeof raw.exp !== 'number') return null
    const exp = raw.exp
    const iat = typeof raw.iat === 'number' ? raw.iat : undefined
    if (exp < nowSec) return null

    if (iat && iat > nowSec + CLOCK_SKEW) return null

    if (raw.role !== 'superadmin' && _revokedTenants.has(raw.tenantId as string)) return null

    return {
      sub:       raw.sub as string,
      role:      raw.role as SessionPayload['role'],
      tenantId:  raw.tenantId as string,
      driverRef: (typeof raw.driverRef === 'string' && raw.driverRef) || undefined,
      trade:     (typeof raw.trade === 'string' && raw.trade) || undefined,
      sv:        typeof raw.sv === 'number' ? raw.sv : undefined,
      iat,
      exp,
    }
  } catch {
    return null
  }
}

export function getSessionFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${SESSION_COOKIE}=`))
  return match ? match.slice(SESSION_COOKIE.length + 1) : null
}
