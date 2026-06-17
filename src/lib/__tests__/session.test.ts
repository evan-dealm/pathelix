process.env.SESSION_SECRET = 'test-secret-at-least-32-characters-long!!'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  signSession,
  verifySession,
  getSessionFromCookieHeader,
  SESSION_COOKIE,
  COOKIE_OPTIONS,
} from '../session'
import type { SessionPayload } from '../session'

const SAMPLE_PAYLOAD: SessionPayload = {
  sub:      'user-123',
  role:     'admin',
  tenantId: 'tenant-abc',
}

describe('signSession + verifySession', () => {
  it('creates a valid JWT that can be verified', async () => {
    const token   = await signSession(SAMPLE_PAYLOAD)
    const payload = await verifySession(token)

    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-123')
    expect(payload!.role).toBe('admin')
    expect(payload!.tenantId).toBe('tenant-abc')
  })

  it('JWT has 3 parts separated by dots', async () => {
    const token = await signSession(SAMPLE_PAYLOAD)
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
  })

  it('JWT contains iat and exp fields', async () => {
    const token   = await signSession(SAMPLE_PAYLOAD)
    const payload = await verifySession(token)

    expect(payload!.iat).toBeDefined()
    expect(payload!.exp).toBeDefined()
    expect(payload!.exp!).toBeGreaterThan(payload!.iat!)
  })

  it('exp is approximately 24 hours after iat', async () => {
    const token   = await signSession(SAMPLE_PAYLOAD)
    const payload = await verifySession(token)

    const diff = payload!.exp! - payload!.iat!
    expect(diff).toBe(86400)
  })

  it('rejects token with empty tenantId', async () => {
    const token = await signSession({ sub: 'user', role: 'driver', tenantId: '' } as SessionPayload)

    const payload = await verifySession(token)
    expect(payload).toBeNull()
  })
})

describe('verifySession — rejection', () => {
  it('rejects tampered token (modified payload)', async () => {
    const token = await signSession(SAMPLE_PAYLOAD)
    const parts = token.split('.')

    const tampered = `${parts[0]}.${parts[1]}X.${parts[2]}`
    const payload = await verifySession(tampered)
    expect(payload).toBeNull()
  })

  it('rejects tampered signature', async () => {
    const token = await signSession(SAMPLE_PAYLOAD)
    const parts = token.split('.')

    const tampered = `${parts[0]}.${parts[1]}.invalidsignature`
    const payload = await verifySession(tampered)
    expect(payload).toBeNull()
  })

  it('rejects token with wrong number of parts', async () => {
    expect(await verifySession('only.two')).toBeNull()
    expect(await verifySession('one')).toBeNull()
    expect(await verifySession('')).toBeNull()
  })

  it('rejects expired token', async () => {

    const token   = await signSession(SAMPLE_PAYLOAD)
    const parts   = token.split('.')

    const payloadB64 = parts[1]
    const padded     = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4)
    const decoded    = JSON.parse(
      Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    )
    decoded.exp = Math.floor(Date.now() / 1000) - 3600

    const newPayload = Buffer.from(JSON.stringify(decoded), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    const expiredToken = `${parts[0]}.${newPayload}.${parts[2]}`
    const payload = await verifySession(expiredToken)
    expect(payload).toBeNull()
  })
})

describe('getSessionFromCookieHeader', () => {
  it('extracts session token from cookie header', () => {
    const token = getSessionFromCookieHeader('session=abc123; other=xyz')
    expect(token).toBe('abc123')
  })

  it('returns null for missing cookie header', () => {
    expect(getSessionFromCookieHeader(null)).toBeNull()
  })

  it('returns null when session cookie is absent', () => {
    expect(getSessionFromCookieHeader('other=xyz; foo=bar')).toBeNull()
  })

  it('handles session cookie at various positions', () => {
    expect(getSessionFromCookieHeader('foo=bar; session=mytoken; baz=qux')).toBe('mytoken')
  })
})

describe('COOKIE_OPTIONS', () => {
  it('sets httpOnly to true', () => {
    expect(COOKIE_OPTIONS.httpOnly).toBe(true)
  })

  it('sets sameSite to strict', () => {
    expect(COOKIE_OPTIONS.sameSite).toBe('strict')
  })

  it('sets path to /', () => {
    expect(COOKIE_OPTIONS.path).toBe('/')
  })

  it('sets maxAge to 86400 (24h)', () => {
    expect(COOKIE_OPTIONS.maxAge).toBe(86400)
  })
})

describe('SESSION_COOKIE', () => {
  it('is named "session"', () => {
    expect(SESSION_COOKIE).toBe('session')
  })
})
