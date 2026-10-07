import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual }            from 'crypto'
import { signSession, SESSION_COOKIE, COOKIE_OPTIONS } from '@/lib/session'
import { LoginSchema }                from '@/lib/schemas'
import { getClientIp } from '@/lib/rateLimit'
import { getRedisClient } from '@/lib/redisClient'
import { createLogger }               from '@/lib/logger'
import { metrics, METRIC }            from '@/lib/metrics'

const log = createLogger('/api/auth/login')

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''
const USE_MOCK       = process.env.USE_MOCK_DATA !== 'false'

// No module-level check: production never runs in mock mode (validateEnv() refuses to start),
// and a throw here broke `next build`, which loads this module without runtime secrets. A mock
// deployment without ADMIN_PASSWORD answers 503 in the handler instead.

/**
 * Counts failed logins per key within a window. An attempt is reserved BEFORE the password check
 * (parallel guesses cannot all slip past the limit) and handed back on success, so only failures
 * accumulate: legitimate sign-ins — a shared tablet, a whole office behind one public IP at 8 am —
 * never lock anyone out. At capacity only expired or below-limit entries are evicted, so a flood
 * of junk keys cannot flush an active lockout.
 *
 * Counts live in Redis when it is available, so a lockout holds on every instance (each process
 * used to grant its own budget); the in-memory counts are the fallback.
 */
class FailureLimiter {
  private readonly prefix: string
  private entries = new Map<string, { count: number; resetAt: number }>()
  readonly max: number
  readonly windowMs: number
  private readonly cap: number
  constructor(prefix: string, max: number, windowMs: number, cap = 10_000) {
    this.prefix = `lf:${prefix}:`
    this.max = max
    this.windowMs = windowMs
    this.cap = cap
  }

  async locked(key: string): Promise<boolean> {
    const r = await Promise.resolve(getRedisClient()).catch(() => null)
    if (r) {
      try { return Number(await r.get(this.prefix + key) ?? 0) >= this.max } catch { /* fall back */ }
    }
    return this.lockedLocal(key)
  }

  async reserve(key: string): Promise<void> {
    const r = await Promise.resolve(getRedisClient()).catch(() => null)
    if (r) {
      try {
        const n = await r.incr(this.prefix + key)
        if (n === 1) await r.pexpire(this.prefix + key, this.windowMs)
        return
      } catch { /* fall back */ }
    }
    this.reserveLocal(key)
  }

  /** The reserved attempt succeeded: give it back. */
  async release(key: string, clear = false): Promise<void> {
    const r = await Promise.resolve(getRedisClient()).catch(() => null)
    if (r) {
      try {
        if (clear) await r.del(this.prefix + key)
        else if (await r.decr(this.prefix + key) <= 0) await r.del(this.prefix + key)
        return
      } catch { /* fall back */ }
    }
    this.releaseLocal(key, clear)
  }

  private lockedLocal(key: string): boolean {
    const e = this.entries.get(key)
    if (!e) return false
    if (Date.now() > e.resetAt) { this.entries.delete(key); return false }
    return e.count >= this.max
  }

  private reserveLocal(key: string): void {
    const now = Date.now()
    const e = this.entries.get(key)
    if (e && now <= e.resetAt) { e.count++; return }
    if (this.entries.size >= this.cap) {
      for (const [k, v] of this.entries) if (now > v.resetAt) this.entries.delete(k)
      if (this.entries.size >= this.cap) {
        let toDrop = Math.ceil(this.cap / 10)
        for (const [k, v] of this.entries) {
          if (v.count < this.max) { this.entries.delete(k); if (--toDrop <= 0) break }
        }
      }
    }
    this.entries.set(key, { count: 1, resetAt: now + this.windowMs })
  }

  private releaseLocal(key: string, clear = false): void {
    const e = this.entries.get(key)
    if (!e) return
    if (clear || e.count <= 1) this.entries.delete(key)
    else e.count--
  }
}

// Per IP: brute force from one address. Per account: distributed guessing on one account.
const _ipFailures      = new FailureLimiter('ip', 20, 60_000)
const _accountFailures = new FailureLimiter('account', 10, 15 * 60_000)

// bcrypt hash of a random string — compared against when the email is unknown, so a miss costs
// the same time as a wrong password and response timing doesn't reveal which emails exist.
const DUMMY_HASH = '$2a$12$gJokVt6sGgIZXVkM4dp5X.ov8ZqUBF7VagdkvgJpEClAZaR16V6.u'

function safePasswordCompare(input: string, expected: string): boolean {
  const maxLen = Math.max(input.length, expected.length, 1)
  const a = Buffer.alloc(maxLen)
  const b = Buffer.alloc(maxLen)
  a.write(input,    0, 'utf8')
  b.write(expected, 0, 'utf8')
  return timingSafeEqual(a, b) && input.length === expected.length
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req.headers)

  if (await _ipFailures.locked(ip)) {
    return NextResponse.json(
      { error: 'Trop de tentatives. Réessayez dans une minute.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
  }

  const { password, email } = parsed.data
  await _ipFailures.reserve(ip)

  const deny = async (msg: string, status = 401): Promise<NextResponse> => {
    await new Promise(r => setTimeout(r, 200))
    metrics.increment(METRIC.AUTH_LOGIN_FAIL)
    log.warn('login failed', { ip, email: email ?? '—' })
    return NextResponse.json({ error: msg }, { status })
  }

  if (!USE_MOCK) {
    if (!email) {
      return NextResponse.json({ error: 'Email requis en mode base de données' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (await _accountFailures.locked(normalizedEmail)) {
      await _ipFailures.release(ip)
      return NextResponse.json(
        { error: 'Trop de tentatives pour ce compte. Réessayez dans quelques minutes.' },
        { status: 429, headers: { 'Retry-After': String(_accountFailures.windowMs / 1000) } },
      )
    }
    await _accountFailures.reserve(normalizedEmail)

    try {
      const { prisma } = await import('@/lib/db')
      const user       = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: { tenant: { select: { trade: true, suspendedAt: true } } },
      })

      const { compare } = await import('bcryptjs')
      const ok = await compare(password, user?.passwordHash ?? DUMMY_HASH)
      if (!user || !ok) return deny('Identifiants incorrects')
      await _accountFailures.release(normalizedEmail, true)
      await _ipFailures.release(ip)

      if (user.tenant?.suspendedAt && user.role !== 'SUPERADMIN') {
        return deny('Compte suspendu. Contactez votre administrateur.', 403)
      }

      const ROLE_MAP: Record<string, 'superadmin' | 'admin' | 'dispatcher' | 'driver'> = {
        SUPERADMIN: 'superadmin', ADMIN: 'admin', DISPATCHER: 'dispatcher', DRIVER: 'driver',
      }
      const role = ROLE_MAP[user.role]
      if (!role) {
        log.error('Unknown role in DB', { userId: user.id, role: user.role })
        return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
      }

      const tenantTrade = user.tenant?.trade || undefined
      const token = await signSession({
        sub:       user.id,
        role,
        tenantId:  user.tenantId,
        driverRef: user.driverRef || undefined,
        trade:     tenantTrade,
        sv:        user.sessionVersion,
      })

      metrics.increment(METRIC.AUTH_LOGIN_OK)
      log.info('login success', { userId: user.id, tenantId: user.tenantId, role: user.role })

      const needsOnboarding = !tenantTrade && (role === 'admin')
      const redirectTo = role === 'superadmin' ? '/superadmin'
        : needsOnboarding ? '/onboarding'
        : role === 'driver' ? `/driver/${user.driverRef || user.id}` : '/admin'
      const response = NextResponse.json({ ok: true, redirectTo })
      response.cookies.set(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: 86400, path: '/' })
      return response
    } catch (err) {
      log.error('login DB error', { err: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }
  }

  if (!ADMIN_PASSWORD) {
    log.error('ADMIN_PASSWORD non configuré — connexion impossible en mode mock')
    return NextResponse.json({ error: 'Serveur mal configuré' }, { status: 503 })
  }

  if (!safePasswordCompare(password, ADMIN_PASSWORD)) {
    return deny('Mot de passe incorrect')
  }
  await _ipFailures.release(ip)

  let mockTrade: string | undefined
  try {
    const { default: prismaClient } = await import('@/lib/db')
    const tenant = await prismaClient.tenant.findUnique({
      where: { id: 'default' },
      select: { trade: true },
    })
    mockTrade = tenant?.trade ?? undefined
  } catch {  }

  const token = await signSession({ sub: 'admin', role: 'admin', tenantId: 'default', trade: mockTrade })

  metrics.increment(METRIC.AUTH_LOGIN_OK)
  log.info('login success', { userId: 'admin', tenantId: 'default', mode: 'mock' })

  const response = NextResponse.json({ ok: true, redirectTo: mockTrade ? '/admin' : '/onboarding' })
  response.cookies.set(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: 86400, path: '/' })
  return response
}
