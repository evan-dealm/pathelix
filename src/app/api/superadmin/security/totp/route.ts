import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import QRCode from 'qrcode'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { logSuperadminAction } from '@/lib/superadminAudit'
import { generateTotpSecret, totpUri, verifyTotp } from '@/lib/totp'
import { openTotpSecret, sealTotpSecret } from '@/lib/superadminPolicy'

const log = createLogger('/api/superadmin/security/totp')

const StartSchema = z.object({ password: z.string().min(1).max(1000) })
const CodeSchema = z.object({ code: z.string().min(6).max(12) })

// Wrong codes per superadmin: 5 in 5 minutes, then the endpoint answers 429. On globalThis so a
// hot reload or a second bundle of this module shares the same counts.
const MAX_FAILURES = 5
const WINDOW_MS = 5 * 60_000
const _g = globalThis as typeof globalThis & { __pathelixTotpFailures?: Map<string, { count: number; resetAt: number }> }
const _failures = (_g.__pathelixTotpFailures ??= new Map<string, { count: number; resetAt: number }>())

function locked(userId: string): boolean {
  const e = _failures.get(userId)
  if (!e) return false
  if (Date.now() > e.resetAt) { _failures.delete(userId); return false }
  return e.count >= MAX_FAILURES
}

function recordFailure(userId: string): void {
  const now = Date.now()
  const e = _failures.get(userId)
  if (e && now <= e.resetAt) e.count++
  else _failures.set(userId, { count: 1, resetAt: now + WINDOW_MS })
}

const forbidden = () => NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
const tooMany = () => NextResponse.json(
  { error: 'Trop de codes incorrects. Réessayez dans quelques minutes.' },
  { status: 429, headers: { 'Retry-After': String(WINDOW_MS / 1000) } },
)

/** Whether the signed-in superadmin has a second factor. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, role } = getRequestContext(req)
  if (role !== 'superadmin') return forbidden()
  try {
    const row = await prisma.superadminTotp.findUnique({
      where: { userId },
      select: { enabledAt: true },
    })
    return NextResponse.json({
      enabled: Boolean(row?.enabledAt),
      enabledAt: row?.enabledAt?.toISOString() ?? null,
      pending: Boolean(row && !row.enabledAt),
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * Starts the enrolment: checks the password again, creates a secret and returns it once (text,
 * otpauth URI and QR code). Nothing is required at sign-in until a first code is confirmed (PUT).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, role } = getRequestContext(req)
  if (role !== 'superadmin') return forbidden()

  const parsed = StartSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, passwordHash: true, totp: { select: { enabledAt: true } } },
    })
    if (!user) return forbidden()
    if (user.totp?.enabledAt) {
      return NextResponse.json({ error: 'La double authentification est déjà active' }, { status: 409 })
    }

    const { compare } = await import('bcryptjs')
    if (!(await compare(parsed.data.password, user.passwordHash))) {
      return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 })
    }

    const secret = generateTotpSecret()
    const sealed = sealTotpSecret(secret) as object
    await prisma.superadminTotp.upsert({
      where: { userId },
      update: { secret: sealed, enabledAt: null, lastStep: null },
      create: { userId, secret: sealed },
    })

    const uri = totpUri(secret, user.email)
    return NextResponse.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

/** Confirms the enrolment with a first code: from now on sign-in asks for one. */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { userId, role, tenantId } = getRequestContext(req)
  if (role !== 'superadmin') return forbidden()
  if (locked(userId)) return tooMany()

  const parsed = CodeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    const row = await prisma.superadminTotp.findUnique({ where: { userId } })
    if (!row) return NextResponse.json({ error: 'Aucune configuration en cours' }, { status: 404 })
    if (row.enabledAt) {
      return NextResponse.json({ error: 'La double authentification est déjà active' }, { status: 409 })
    }

    const secret = openTotpSecret(row.secret)
    const step = secret ? verifyTotp(secret, parsed.data.code) : null
    if (step === null) {
      recordFailure(userId)
      return NextResponse.json({ error: 'Code incorrect' }, { status: 401 })
    }

    const enabledAt = new Date()
    await prisma.superadminTotp.update({ where: { userId }, data: { enabledAt, lastStep: step } })
    await logSuperadminAction({
      superadminId: userId,
      targetTenantId: tenantId,
      isImpersonation: false,
      method: 'PUT',
      path: '/api/superadmin/security/totp',
      action: 'totp_enabled',
    })
    return NextResponse.json({ ok: true, enabled: true, enabledAt: enabledAt.toISOString() })
  } catch (err) {
    log.error('PUT failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * Turns the second factor off (or abandons an enrolment that was never confirmed). An active
 * factor is only removed against a valid code: a stolen session alone cannot weaken the account.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { userId, role, tenantId } = getRequestContext(req)
  if (role !== 'superadmin') return forbidden()
  if (locked(userId)) return tooMany()

  try {
    const row = await prisma.superadminTotp.findUnique({ where: { userId } })
    if (!row) return NextResponse.json({ ok: true, enabled: false })

    if (row.enabledAt) {
      const parsed = CodeSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return NextResponse.json({ error: 'Code requis' }, { status: 422 })
      const secret = openTotpSecret(row.secret)
      const step = secret ? verifyTotp(secret, parsed.data.code, { lastStep: row.lastStep }) : null
      if (step === null) {
        recordFailure(userId)
        return NextResponse.json({ error: 'Code incorrect' }, { status: 401 })
      }
    }

    await prisma.superadminTotp.delete({ where: { userId } })
    if (row.enabledAt) {
      await logSuperadminAction({
        superadminId: userId,
        targetTenantId: tenantId,
        isImpersonation: false,
        method: 'DELETE',
        path: '/api/superadmin/security/totp',
        action: 'totp_disabled',
      })
    }
    return NextResponse.json({ ok: true, enabled: false })
  } catch (err) {
    log.error('DELETE failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
