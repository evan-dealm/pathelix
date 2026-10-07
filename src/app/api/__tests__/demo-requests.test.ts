import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { create, deleteMany, sendMail, check } = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'dr-1' })),
  deleteMany: vi.fn(async () => ({ count: 0 })),
  sendMail: vi.fn(),
  check: vi.fn(async () => true),
}))

vi.mock('@/lib/tenantDb', () => ({ unscopedPrisma: { demoRequest: { create, deleteMany } } }))
vi.mock('@/lib/mailer', () => ({ sendMail }))
vi.mock('@/lib/rateLimit', () => ({
  createRateLimiter: () => ({ check }),
  getClientIp: () => '1.2.3.4',
}))

import { POST } from '@/app/api/demo-requests/route'

const VALID = {
  firstName: ' Camille ',
  lastName: 'Martin',
  company: 'Bennes du Lac',
  email: ' Camille.Martin@Example.FR ',
  phone: '04 50 00 00 00',
  fleetSize: '6-15',
  message: 'Douze chauffeurs, deux dépôts.',
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/demo-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/demo-requests', () => {
  const originalMock = process.env.USE_MOCK_DATA

  beforeEach(() => {
    vi.clearAllMocks()
    check.mockResolvedValue(true)
    sendMail.mockResolvedValue({ sent: false, reason: 'NOT_CONFIGURED' })
    process.env.USE_MOCK_DATA = 'false'
  })

  afterEach(() => {
    process.env.USE_MOCK_DATA = originalMock
  })

  it('stores a valid request, trimmed and with a lower-cased e-mail, and answers 201', async () => {
    const res = await POST(post(VALID))
    expect(res.status).toBe(201)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({
      data: {
        firstName: 'Camille',
        lastName: 'Martin',
        company: 'Bennes du Lac',
        email: 'camille.martin@example.fr',
        phone: '04 50 00 00 00',
        fleetSize: '6-15',
        message: 'Douze chauffeurs, deux dépôts.',
      },
    })
  })

  it('never writes the honeypot field to the database', async () => {
    await POST(post({ ...VALID, website: '' }))
    const [[arg]] = create.mock.calls as unknown as [[{ data: Record<string, unknown> }]]
    expect(arg.data).not.toHaveProperty('website')
  })

  it('e-mails the team with the prospect as reply-to', async () => {
    sendMail.mockResolvedValue({ sent: true })
    await POST(post(VALID))
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: 'camille.martin@example.fr',
        subject: 'Demande de démo — Bennes du Lac',
        text: expect.stringContaining('6 à 15 chauffeurs'),
      }),
    )
  })

  it('refuses a request without the required fields (422) and stores nothing', async () => {
    for (const missing of ['firstName', 'lastName', 'company', 'email'] as const) {
      const res = await POST(post({ ...VALID, [missing]: '   ' }))
      expect(res.status, missing).toBe(422)
    }
    expect((await POST(post({ ...VALID, email: 'pas-un-email' }))).status).toBe(422)
    expect((await POST(post({ ...VALID, fleetSize: '1000' }))).status).toBe(422)
    expect((await POST(post({ ...VALID, message: 'x'.repeat(2001) }))).status).toBe(422)
    expect((await POST(post('{not json'))).status).toBe(422)
    expect(create).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('a filled honeypot is answered like a success but nothing is stored or sent', async () => {
    const res = await POST(post({ ...VALID, website: 'https://spam.example' }))
    expect(res.status).toBe(201)
    expect(create).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('answers 429 once the per-address limit is reached, before reading the body', async () => {
    check.mockResolvedValue(false)
    const res = await POST(post(VALID))
    expect(res.status).toBe(429)
    expect(create).not.toHaveBeenCalled()
  })

  it('does not claim success when the request could be neither stored nor e-mailed (503 with the contact address)', async () => {
    create.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(post(VALID))
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toContain('support@pathelix.com')
  })

  it('still succeeds when the database is down but the e-mail left', async () => {
    create.mockRejectedValueOnce(new Error('db down'))
    sendMail.mockResolvedValue({ sent: true })
    expect((await POST(post(VALID))).status).toBe(201)
  })

  it('in demo (mock) mode there is no database: success only if the e-mail was sent', async () => {
    process.env.USE_MOCK_DATA = 'true'
    expect((await POST(post(VALID))).status).toBe(503)
    expect(create).not.toHaveBeenCalled()
    sendMail.mockResolvedValue({ sent: true })
    expect((await POST(post(VALID))).status).toBe(201)
  })

  it('purges requests older than three years when a new one arrives', async () => {
    await POST(post(VALID))
    const [[arg]] = deleteMany.mock.calls as unknown as [[{ where: { createdAt: { lt: Date } } }]]
    const ageDays = (Date.now() - arg.where.createdAt.lt.getTime()) / 86_400_000
    expect(Math.round(ageDays)).toBe(1095)
  })
})
