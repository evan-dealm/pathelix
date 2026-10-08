/**
 * Second factor of the superadmin account: enrolment, confirmation, removal
 * (/api/superadmin/security/totp) and the password policy that goes with the role.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { totpCode, totpStep } from '@/lib/totp'
import { superadminPasswordIssue } from '@/lib/superadminPolicy'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
const mockAudit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/superadminAudit', () => ({ logSuperadminAction: mockAudit }))
vi.mock('@/lib/data/context', () => ({ getRequestContext: vi.fn() }))
const mockCompare = vi.hoisted(() => vi.fn(async () => true))
vi.mock('bcryptjs', () => ({ compare: mockCompare }))

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  superadminTotp: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ default: db }))

import { GET, POST, PUT, DELETE } from '@/app/api/superadmin/security/totp/route'
import { getRequestContext } from '@/lib/data/context'

const mockCtx = vi.mocked(getRequestContext)
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const validCode = () => totpCode(SECRET, totpStep())

let userSeq = 0
/** A fresh superadmin per test: the wrong-code counter is kept per user in module state. */
function asSuperadmin(): string {
  const userId = `sa-${++userSeq}`
  mockCtx.mockReturnValue({ tenantId: 'platform', userId, role: 'superadmin', requestId: 'r', trade: null })
  return userId
}

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/superadmin/security/totp', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', '')
  mockCompare.mockResolvedValue(true)
  asSuperadmin()
})

describe('access', () => {
  it.each(['admin', 'dispatcher', 'driver'])('refuses role %s on every method', async role => {
    mockCtx.mockReturnValue({ tenantId: 't1', userId: 'u1', role, requestId: 'r', trade: null })
    expect((await GET(req('GET'))).status).toBe(403)
    expect((await POST(req('POST', { password: 'x' }))).status).toBe(403)
    expect((await PUT(req('PUT', { code: '123456' }))).status).toBe(403)
    expect((await DELETE(req('DELETE', { code: '123456' }))).status).toBe(403)
    expect(db.superadminTotp.findUnique).not.toHaveBeenCalled()
  })
})

describe('GET — status', () => {
  it('reports inactive when nothing is configured', async () => {
    db.superadminTotp.findUnique.mockResolvedValueOnce(null)
    expect(await (await GET(req('GET'))).json()).toEqual({ enabled: false, enabledAt: null, pending: false })
  })

  it('reports pending, then enabled', async () => {
    db.superadminTotp.findUnique.mockResolvedValueOnce({ enabledAt: null })
    expect((await (await GET(req('GET'))).json()).pending).toBe(true)
    db.superadminTotp.findUnique.mockResolvedValueOnce({ enabledAt: new Date('2026-10-08T08:00:00Z') })
    const body = await (await GET(req('GET'))).json()
    expect(body.enabled).toBe(true)
    expect(body.enabledAt).toBe('2026-10-08T08:00:00.000Z')
  })
})

describe('POST — start the enrolment', () => {
  it('refuses a wrong password and stores nothing', async () => {
    db.user.findUnique.mockResolvedValueOnce({ email: 'sa@x.fr', passwordHash: 'h', totp: null })
    mockCompare.mockResolvedValueOnce(false)
    const res = await POST(req('POST', { password: 'wrong' }))
    expect(res.status).toBe(401)
    expect(db.superadminTotp.upsert).not.toHaveBeenCalled()
  })

  it('refuses when the factor is already active', async () => {
    db.user.findUnique.mockResolvedValueOnce({ email: 'sa@x.fr', passwordHash: 'h', totp: { enabledAt: new Date() } })
    expect((await POST(req('POST', { password: 'ok' }))).status).toBe(409)
  })

  it('returns a secret, its URI and a QR code, stored but not yet enabled', async () => {
    const userId = asSuperadmin()
    db.user.findUnique.mockResolvedValueOnce({ email: 'sa@x.fr', passwordHash: 'h', totp: null })
    const res = await POST(req('POST', { password: 'ok' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(body.uri).toContain(`secret=${body.secret}`)
    expect(body.qr.startsWith('data:image/png;base64,')).toBe(true)
    const arg = db.superadminTotp.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ userId })
    expect(arg.create).toEqual({ userId, secret: { secret: body.secret } })
    expect(arg.update.enabledAt).toBeNull()
  })

  it('stores the secret encrypted when the encryption key is set', async () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', 'a'.repeat(64))
    db.user.findUnique.mockResolvedValueOnce({ email: 'sa@x.fr', passwordHash: 'h', totp: null })
    const body = await (await POST(req('POST', { password: 'ok' }))).json()
    const stored = db.superadminTotp.upsert.mock.calls[0][0].create.secret
    expect(stored.v).toBe(1)
    expect(JSON.stringify(stored)).not.toContain(body.secret)
  })
})

describe('PUT — confirm with a first code', () => {
  it('refuses a wrong code and leaves the factor disabled', async () => {
    db.superadminTotp.findUnique.mockResolvedValueOnce({ secret: { secret: SECRET }, enabledAt: null, lastStep: null })
    const res = await PUT(req('PUT', { code: '000000' }))
    expect(res.status).toBe(401)
    expect(db.superadminTotp.update).not.toHaveBeenCalled()
  })

  it('enables the factor with a valid code and writes the audit entry', async () => {
    db.superadminTotp.findUnique.mockResolvedValueOnce({ secret: { secret: SECRET }, enabledAt: null, lastStep: null })
    const res = await PUT(req('PUT', { code: validCode() }))
    expect(res.status).toBe(200)
    const data = db.superadminTotp.update.mock.calls[0][0].data
    expect(data.enabledAt).toBeInstanceOf(Date)
    expect(typeof data.lastStep).toBe('number')
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'totp_enabled' }))
  })

  it('answers 404 when no enrolment was started', async () => {
    db.superadminTotp.findUnique.mockResolvedValueOnce(null)
    expect((await PUT(req('PUT', { code: validCode() }))).status).toBe(404)
  })

  it('locks after five wrong codes', async () => {
    db.superadminTotp.findUnique.mockResolvedValue({ secret: { secret: SECRET }, enabledAt: null, lastStep: null })
    for (let i = 0; i < 5; i++) expect((await PUT(req('PUT', { code: '000000' }))).status).toBe(401)
    // Even the right code is refused while locked.
    expect((await PUT(req('PUT', { code: validCode() }))).status).toBe(429)
    db.superadminTotp.findUnique.mockReset()
  })
})

describe('DELETE — remove the factor', () => {
  it('requires a valid code when the factor is active', async () => {
    db.superadminTotp.findUnique.mockResolvedValue({ secret: { secret: SECRET }, enabledAt: new Date(), lastStep: null })
    expect((await DELETE(req('DELETE'))).status).toBe(422)
    expect((await DELETE(req('DELETE', { code: '000000' }))).status).toBe(401)
    expect(db.superadminTotp.delete).not.toHaveBeenCalled()
    db.superadminTotp.findUnique.mockReset()
  })

  it('refuses a code that was already used to sign in', async () => {
    db.superadminTotp.findUnique.mockResolvedValueOnce({ secret: { secret: SECRET }, enabledAt: new Date(), lastStep: totpStep() + 1 })
    expect((await DELETE(req('DELETE', { code: validCode() }))).status).toBe(401)
  })

  it('removes the factor with a valid code and writes the audit entry', async () => {
    db.superadminTotp.findUnique.mockResolvedValueOnce({ secret: { secret: SECRET }, enabledAt: new Date(), lastStep: null })
    const res = await DELETE(req('DELETE', { code: validCode() }))
    expect(res.status).toBe(200)
    expect(db.superadminTotp.delete).toHaveBeenCalled()
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'totp_disabled' }))
  })

  it('abandons an unconfirmed enrolment without a code', async () => {
    db.superadminTotp.findUnique.mockResolvedValueOnce({ secret: { secret: SECRET }, enabledAt: null, lastStep: null })
    expect((await DELETE(req('DELETE'))).status).toBe(200)
    expect(db.superadminTotp.delete).toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalled()
  })
})

describe('superadminPasswordIssue', () => {
  it.each(['short1A', 'alllowercase123', 'ALLUPPERCASE123', 'NoDigitsAtAllHere'])('refuses %s', pwd => {
    expect(superadminPasswordIssue(pwd)).not.toBeNull()
  })

  it('accepts 12 characters mixing lowercase, uppercase and digits', () => {
    expect(superadminPasswordIssue('Correct7Horse')).toBeNull()
  })
})
