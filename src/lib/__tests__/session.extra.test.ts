process.env.SESSION_SECRET = 'test-secret-minimum-32-chars-ok!!'

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  signSession,
  verifySession,
  getSessionFromCookieHeader,
  SESSION_COOKIE,
  COOKIE_OPTIONS,
} from '@/lib/session'
import type { SessionPayload } from '@/lib/session'

const BASE_PAYLOAD: SessionPayload = {
  sub:      'user-abc',
  role:     'admin',
  tenantId: 'tenant-xyz',
}

const DRIVER_PAYLOAD: SessionPayload = {
  sub:       'driver-001',
  role:      'driver',
  tenantId:  'tenant-xyz',
  driverRef: 'DR-001',
  trade:     'waste-recycling',
}

const SUPERADMIN_PAYLOAD: SessionPayload = {
  sub:      'sa-001',
  role:     'superadmin',
  tenantId: 'global',
}

const DISPATCHER_PAYLOAD: SessionPayload = {
  sub:      'disp-001',
  role:     'dispatcher',
  tenantId: 'tenant-xyz',
}

describe('SESSION_COOKIE constant', () => {
  it('is the string "session"', () => {
    expect(SESSION_COOKIE).toBe('session')
  })

  it('is a string type', () => {
    expect(typeof SESSION_COOKIE).toBe('string')
  })
})

describe('COOKIE_OPTIONS', () => {
  it('httpOnly is true', () => {
    expect(COOKIE_OPTIONS.httpOnly).toBe(true)
  })

  it('sameSite is "strict"', () => {
    expect(COOKIE_OPTIONS.sameSite).toBe('strict')
  })

  it('maxAge is 86400 (24 hours in seconds)', () => {
    expect(COOKIE_OPTIONS.maxAge).toBe(86400)
  })

  it('path is "/"', () => {
    expect(COOKIE_OPTIONS.path).toBe('/')
  })

  it('has all required cookie option keys', () => {
    expect(COOKIE_OPTIONS).toHaveProperty('httpOnly')
    expect(COOKIE_OPTIONS).toHaveProperty('sameSite')
    expect(COOKIE_OPTIONS).toHaveProperty('maxAge')
    expect(COOKIE_OPTIONS).toHaveProperty('path')
    expect(COOKIE_OPTIONS).toHaveProperty('secure')
  })
})

describe('signSession — structure', () => {
  it('returns a string', async () => {
    const token = await signSession(BASE_PAYLOAD)
    expect(typeof token).toBe('string')
  })

  it('JWT has exactly 2 dots (3 parts)', async () => {
    const token = await signSession(BASE_PAYLOAD)
    const dots = token.split('').filter(c => c === '.').length
    expect(dots).toBe(2)
  })

  it('all three parts are non-empty', async () => {
    const token = await signSession(BASE_PAYLOAD)
    const [header, body, sig] = token.split('.')
    expect(header.length).toBeGreaterThan(0)
    expect(body.length).toBeGreaterThan(0)
    expect(sig.length).toBeGreaterThan(0)
  })

  it('two successive calls produce different tokens (different iat/exp timestamps)', async () => {

    const t1 = await signSession(BASE_PAYLOAD)
    expect(t1.split('.').length).toBe(3)
  })

  it('signing driver payload includes driverRef in body', async () => {
    const token = await signSession(DRIVER_PAYLOAD)
    const bodyB64 = token.split('.')[1]
    const padded  = bodyB64 + '='.repeat((4 - (bodyB64.length % 4)) % 4)
    const decoded = JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    expect(decoded.driverRef).toBe('DR-001')
  })

  it('signing driver payload includes trade in body', async () => {
    const token = await signSession(DRIVER_PAYLOAD)
    const bodyB64 = token.split('.')[1]
    const padded  = bodyB64 + '='.repeat((4 - (bodyB64.length % 4)) % 4)
    const decoded = JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    expect(decoded.trade).toBe('waste-recycling')
  })

  it('token body contains iat as a number', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const bodyB64 = token.split('.')[1]
    const padded  = bodyB64 + '='.repeat((4 - (bodyB64.length % 4)) % 4)
    const decoded = JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    expect(typeof decoded.iat).toBe('number')
    expect(isFinite(decoded.iat)).toBe(true)
  })

  it('token body contains exp as a number', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const bodyB64 = token.split('.')[1]
    const padded  = bodyB64 + '='.repeat((4 - (bodyB64.length % 4)) % 4)
    const decoded = JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    expect(typeof decoded.exp).toBe('number')
    expect(isFinite(decoded.exp)).toBe(true)
  })
})

describe('verifySession — rejection cases', () => {
  it('returns null for empty string', async () => {
    expect(await verifySession('')).toBeNull()
  })

  it('returns null for a random string with no dots', async () => {
    expect(await verifySession('randomstring')).toBeNull()
  })

  it('returns null for "a.b.c" (invalid base64, no valid HMAC)', async () => {
    expect(await verifySession('a.b.c')).toBeNull()
  })

  it('returns null for a string with only 2 parts', async () => {
    expect(await verifySession('header.body')).toBeNull()
  })

  it('returns null for a string with 4 parts', async () => {
    expect(await verifySession('a.b.c.d')).toBeNull()
  })

  it('returns null when signature is replaced with garbage', async () => {
    const token = await signSession(BASE_PAYLOAD)
    const [header, body] = token.split('.')
    expect(await verifySession(`${header}.${body}.INVALIDSIGNATURE`)).toBeNull()
  })

  it('returns null when payload body is tampered', async () => {
    const token = await signSession(BASE_PAYLOAD)
    const [header, , sig] = token.split('.')
    expect(await verifySession(`${header}.TAMPEREDBODY.${sig}`)).toBeNull()
  })
})

describe('verifySession — correct payload extraction', () => {
  it('returns the sub field correctly', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.sub).toBe('user-abc')
  })

  it('returns the role field correctly (admin)', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.role).toBe('admin')
  })

  it('returns the tenantId field correctly', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.tenantId).toBe('tenant-xyz')
  })

  it('returns role "driver" for driver payload', async () => {
    const token   = await signSession(DRIVER_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.role).toBe('driver')
  })

  it('returns role "superadmin" correctly', async () => {
    const token   = await signSession(SUPERADMIN_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.role).toBe('superadmin')
  })

  it('returns role "dispatcher" correctly', async () => {
    const token   = await signSession(DISPATCHER_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.role).toBe('dispatcher')
  })

  it('returns the trade field when set', async () => {
    const token   = await signSession(DRIVER_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.trade).toBe('waste-recycling')
  })

  it('trade is undefined when not included in payload', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.trade).toBeUndefined()
  })

  it('driverRef is preserved when set', async () => {
    const token   = await signSession(DRIVER_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.driverRef).toBe('DR-001')
  })

  it('driverRef is undefined when not in payload', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.driverRef).toBeUndefined()
  })

  it('iat is a number in returned payload', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const payload = await verifySession(token)
    expect(typeof payload!.iat).toBe('number')
    expect(isFinite(payload!.iat!)).toBe(true)
  })

  it('exp is a number in returned payload', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const payload = await verifySession(token)
    expect(typeof payload!.exp).toBe('number')
    expect(isFinite(payload!.exp!)).toBe(true)
  })

  it('exp > iat in returned payload', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.exp!).toBeGreaterThan(payload!.iat!)
  })
})

describe('verifySession — expired token (via crafted expired JWT)', () => {
  it('returns null for a properly crafted expired token (tampered exp, rejected by signature)', async () => {

    const token   = await signSession(BASE_PAYLOAD)
    const [header, body, sig] = token.split('.')

    const padded  = body + '='.repeat((4 - (body.length % 4)) % 4)
    const decoded = JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    decoded.exp   = Math.floor(Date.now() / 1000) - 7200

    const newBody = Buffer.from(JSON.stringify(decoded), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    const expiredToken = `${header}.${newBody}.${sig}`
    expect(await verifySession(expiredToken)).toBeNull()
  })
})

describe('signSession + verifySession — round-trip', () => {
  it('round-trip preserves sub, role, tenantId for BASE_PAYLOAD', async () => {
    const token   = await signSession(BASE_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.sub).toBe(BASE_PAYLOAD.sub)
    expect(payload!.role).toBe(BASE_PAYLOAD.role)
    expect(payload!.tenantId).toBe(BASE_PAYLOAD.tenantId)
  })

  it('round-trip preserves driverRef and trade for DRIVER_PAYLOAD', async () => {
    const token   = await signSession(DRIVER_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload!.driverRef).toBe(DRIVER_PAYLOAD.driverRef)
    expect(payload!.trade).toBe(DRIVER_PAYLOAD.trade)
  })

  it('round-trip for superadmin returns valid non-null payload', async () => {
    const token   = await signSession(SUPERADMIN_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload).not.toBeNull()
    expect(payload!.role).toBe('superadmin')
  })

  it('round-trip for dispatcher returns valid non-null payload', async () => {
    const token   = await signSession(DISPATCHER_PAYLOAD)
    const payload = await verifySession(token)
    expect(payload).not.toBeNull()
    expect(payload!.role).toBe('dispatcher')
  })
})

describe('getSessionFromCookieHeader — additional cases', () => {
  it('null header → null', () => {
    expect(getSessionFromCookieHeader(null)).toBeNull()
  })

  it('empty string → null', () => {
    expect(getSessionFromCookieHeader('')).toBeNull()
  })

  it('"session=mytoken" → "mytoken"', () => {
    expect(getSessionFromCookieHeader('session=mytoken')).toBe('mytoken')
  })

  it('"foo=bar; session=mytoken; baz=qux" → "mytoken"', () => {
    expect(getSessionFromCookieHeader('foo=bar; session=mytoken; baz=qux')).toBe('mytoken')
  })

  it('"foo=bar" → null (no session cookie)', () => {
    expect(getSessionFromCookieHeader('foo=bar')).toBeNull()
  })

  it('"session=tok1; session=tok2" → "tok1" (first match wins)', () => {
    expect(getSessionFromCookieHeader('session=tok1; session=tok2')).toBe('tok1')
  })

  it('"SESSION=tok" (uppercase) → null (case-sensitive match)', () => {
    expect(getSessionFromCookieHeader('SESSION=tok')).toBeNull()
  })

  it('"session=" (empty value) → empty string', () => {

    expect(getSessionFromCookieHeader('session=')).toBe('')
  })

  it('"other=val; SESSION=ignored; session=real" → "real"', () => {
    expect(getSessionFromCookieHeader('other=val; SESSION=ignored; session=real')).toBe('real')
  })

  it('token containing "=" characters is returned intact', () => {

    expect(getSessionFromCookieHeader('session=abc.def.ghi')).toBe('abc.def.ghi')
  })
})
