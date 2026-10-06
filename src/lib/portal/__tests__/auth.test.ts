import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashInviteToken, newInviteToken, signPortalToken, verifyPortalToken } from '../auth'
import { inviteUrl, makeInvite } from '../invite'

const SESSION = { sub: 'pu1', tenantId: 't1', clientId: 'c1', sv: 3 }

describe('portal session tokens', () => {
  beforeEach(() => { vi.stubEnv('SESSION_SECRET', 'x'.repeat(48)) })
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

  it('round-trips tenant, customer and session version', () => {
    const s = verifyPortalToken(signPortalToken(SESSION))
    expect(s).toMatchObject(SESSION)
  })

  it('rejects a tampered payload (other customer)', () => {
    const [h, , sig] = signPortalToken(SESSION).split('.')
    const forged = Buffer.from(JSON.stringify({ ...SESSION, clientId: 'c2', role: 'customer', exp: 9_999_999_999 })).toString('base64url')
    expect(verifyPortalToken(`${h}.${forged}.${sig}`)).toBeNull()
  })

  it('rejects a token signed with the staff key (no key confusion)', () => {
    const head = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ ...SESSION, role: 'customer', exp: 9_999_999_999 })).toString('base64url')
    const sig = createHmac('sha256', process.env.SESSION_SECRET ?? '').update(`${head}.${body}`).digest('base64url')
    expect(verifyPortalToken(`${head}.${body}.${sig}`)).toBeNull()
  })

  it('rejects an expired token and garbage', () => {
    const t = signPortalToken(SESSION, -10)
    expect(verifyPortalToken(t)).toBeNull()
    expect(verifyPortalToken(undefined)).toBeNull()
    expect(verifyPortalToken('a.b')).toBeNull()
    expect(verifyPortalToken('a.b.c')).toBeNull()
  })

  it('refuses to sign without SESSION_SECRET', () => {
    vi.stubEnv('SESSION_SECRET', '')
    expect(() => signPortalToken(SESSION)).toThrow()
  })
})

describe('portal invitations', () => {
  it('stores only a hash; tokens are random and URL-safe', () => {
    const a = makeInvite(); const b = makeInvite()
    expect(a.token).not.toBe(b.token)
    expect(a.hash).toBe(hashInviteToken(a.token))
    expect(a.hash).not.toContain(a.token)
    expect(newInviteToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000)
  })

  it('builds the link on the request origin', () => {
    expect(inviteUrl('https://app.example.fr/', 'ab+c')).toBe('https://app.example.fr/portal/invite?token=ab%2Bc')
  })
})
