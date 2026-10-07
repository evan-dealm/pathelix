import { NextRequest, NextResponse } from 'next/server'
import { unscopedPrisma } from '@/lib/tenantDb'
import { createRateLimiter, getClientIp } from '@/lib/rateLimit'
import { sendMail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'
import { CONTACT_EMAIL, FLEET_SIZE_LABELS } from '@/lib/site/config'
import { DemoRequestSchema } from '@/lib/site/demoRequest'

const log = createLogger('/api/demo-requests')

// Anonymous endpoint: a person sends one request, not five in ten minutes.
const ipLimiter = createRateLimiter(5, 10 * 60_000, { redis: true, prefix: 'rl:demo-request-ip' })

/** Prospect data is not kept forever: anything older is removed when a new request arrives. */
const RETENTION_MS = 3 * 365 * 24 * 60 * 60 * 1000

const UNAVAILABLE = `La demande n’a pas pu être enregistrée. Écrivez-nous à ${CONTACT_EMAIL}.`

/**
 * Demo request from the public website (/contact). Platform-level: it belongs to no tenant, hence
 * `unscopedPrisma`. The request is stored (when a database is in use) and e-mailed to the team
 * (when SMTP is configured); the visitor is told « envoyée » only if at least one of the two
 * actually happened.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await ipLimiter.check(getClientIp(req.headers)))) {
    return NextResponse.json(
      { error: 'Trop de demandes — réessayez dans quelques minutes.' },
      { status: 429 },
    )
  }
  const parsed = DemoRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Formulaire incomplet ou invalide.', fields: parsed.error.flatten().fieldErrors },
      { status: 422 },
    )
  }
  const { website, ...request } = parsed.data
  // Honeypot filled: an automated submission. Answer as if accepted, keep nothing.
  if (website) return NextResponse.json({ ok: true }, { status: 201 })

  let stored = false
  if (process.env.USE_MOCK_DATA === 'false') {
    try {
      await unscopedPrisma.demoRequest.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
      })
      await unscopedPrisma.demoRequest.create({ data: request })
      stored = true
    } catch (err) {
      log.error('Demo request not stored', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const mail = await sendMail({
    to: process.env.DEMO_REQUEST_TO || CONTACT_EMAIL,
    replyTo: request.email,
    subject: `Demande de démo — ${request.company}`,
    text: [
      `${request.firstName} ${request.lastName}`,
      `Entreprise : ${request.company}`,
      `E-mail : ${request.email}`,
      `Téléphone : ${request.phone || 'non précisé'}`,
      `Taille : ${request.fleetSize ? FLEET_SIZE_LABELS[request.fleetSize] : 'non précisée'}`,
      '',
      request.message || '(pas de message)',
    ].join('\n'),
  })

  if (!stored && !mail.sent) {
    log.warn('Demo request could be neither stored nor e-mailed', {
      mail: mail.sent ? 'sent' : mail.reason,
    })
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 })
  }
  log.info('Demo request received', { stored, mailed: mail.sent })
  return NextResponse.json({ ok: true }, { status: 201 })
}
