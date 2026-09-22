export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { checkTenantSuspension } from '@/lib/data/context'

const _globalRl = new Map<string, { count: number; resetAt: number }>()
const GLOBAL_RL_MAX    = 300
const GLOBAL_RL_WINDOW = 60_000
const GLOBAL_RL_CAP    = 10_000

function globalRlCheck(ip: string): boolean {
  const now = Date.now()

  if (_globalRl.size >= GLOBAL_RL_CAP) {
    for (const [key, bucket] of _globalRl) {
      if (now > bucket.resetAt) _globalRl.delete(key)
    }
  }

  const bucket = _globalRl.get(ip)
  if (!bucket || now > bucket.resetAt) {
    _globalRl.set(ip, { count: 1, resetAt: now + GLOBAL_RL_WINDOW })
    return true
  }
  if (bucket.count >= GLOBAL_RL_MAX) return false
  bucket.count++
  return true
}

const PUBLIC_PATHS: Array<string | RegExp> = [
  '/login',
  /^\/api\/auth\/(?!me)/,
  '/api/health',
  '/api/ready',
  '/api/metrics',
  '/api/status',
  '/status',
  '/help',
  /^\/driver\//,
  /^\/api\/driver-plan\//,
  /^\/api\/driver-status$/,
  '/api/webhooks/nessy',
  '/api/webhooks/geotab',
  '/api/webhooks/samsara',
  '/api/webhooks/obd',
  // Auto-protégés par HMAC (timingSafeEqual) — appelés par des services externes sans session
  '/api/webhooks/trackdechets',
  '/api/ai/callback',
]

const SUPERADMIN_ONLY_PATTERNS: RegExp[] = [
  /^\/superadmin/,
  /^\/api\/superadmin/,
]

const ADMIN_ONLY_PATTERNS: RegExp[] = [
  /^\/admin/,
  /^\/api\/drivers/,
  /^\/api\/missions/,
  /^\/api\/exutoires/,
  /^\/api\/plans/,
  /^\/api\/optimize/,
  /^\/api\/history/,
  /^\/api\/webhooks/,
  /^\/api\/routing/,
  /^\/api\/trimble/,
  /^\/api\/sse\//,
  /^\/api\/users/,
  /^\/api\/audit/,
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(p =>
    typeof p === 'string' ? pathname === p || pathname.startsWith(p + '/') : p.test(pathname),
  )
}

function requiresSuperAdmin(pathname: string): boolean {
  return SUPERADMIN_ONLY_PATTERNS.some(p => p.test(pathname))
}

function requiresAdmin(pathname: string): boolean {
  return ADMIN_ONLY_PATTERNS.some(p => p.test(pathname))
}

const MAX_BODY_BYTES = 5 * 1024 * 1024

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  const contentLength = request.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'Requête trop volumineuse (max 5 MB)' },
      { status: 413 },
    )
  }

  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
               ?? request.headers.get('x-real-ip')
               ?? 'unknown'
  if (!isPublic(pathname) && !globalRlCheck(clientIp)) {
    return NextResponse.json(
      { error: 'Trop de requêtes. Réessayez dans une minute.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  const requestId      = crypto.randomUUID()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  const isNessyWebhook = pathname === '/api/webhooks/nessy'
  if (!isNessyWebhook) {
    requestHeaders.delete('x-tenant-id')
  }
  requestHeaders.delete('x-user-id')
  requestHeaders.delete('x-user-role')
  requestHeaders.delete('x-tenant-trade')

  function withContext(response: NextResponse): NextResponse {
    response.headers.set('x-request-id', requestId)
    return response
  }

  if (isPublic(pathname)) {
    return withContext(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  const token   = request.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return withContext(NextResponse.json({ error: 'Non authentifié' }, { status: 401 }))
    }
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('from', pathname)
    return withContext(NextResponse.redirect(loginUrl))
  }

  requestHeaders.set('x-tenant-id', session.tenantId)
  requestHeaders.set('x-user-id',   session.sub)
  requestHeaders.set('x-user-role',  session.role)
  if (session.trade) requestHeaders.set('x-tenant-trade', session.trade)

  const suspensionResponse = await checkTenantSuspension(session.tenantId, session.role)
  if (suspensionResponse) return withContext(suspensionResponse)

  const isOnboardingPath = pathname === '/onboarding' || pathname === '/api/onboarding'
  if (!session.trade && !isOnboardingPath && (session.role === 'admin' || session.role === 'dispatcher')) {

    if (!pathname.startsWith('/api/')) {
      const onboardingUrl = request.nextUrl.clone()
      onboardingUrl.pathname = '/onboarding'
      return withContext(NextResponse.redirect(onboardingUrl))
    }
  }

  const isExitImpersonation = pathname === '/api/superadmin/exit-impersonation'
  const isImpersonatingSession = session.sub.startsWith('sa:')

  if (requiresSuperAdmin(pathname) && session.role !== 'superadmin' && !(isExitImpersonation && isImpersonatingSession)) {
    if (pathname.startsWith('/api/')) {
      return withContext(
        NextResponse.json({ error: 'Accès refusé — rôle superadmin requis' }, { status: 403 }),
      )
    }
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = session.role === 'driver'
      ? `/driver/${session.driverRef ?? session.sub}`
      : '/admin'
    return withContext(NextResponse.redirect(redirectUrl))
  }

  if (requiresAdmin(pathname) && session.role !== 'admin' && session.role !== 'dispatcher' && session.role !== 'superadmin') {
    if (pathname.startsWith('/api/')) {
      return withContext(
        NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 }),
      )
    }
    const driverUrl = request.nextUrl.clone()
    driverUrl.pathname = `/driver/${session.driverRef ?? session.sub}`
    return withContext(NextResponse.redirect(driverUrl))
  }

  return withContext(NextResponse.next({ request: { headers: requestHeaders } }))
}

export const config = {
  // maplibre/<version>/maplibre-gl-worker.mjs / .../maplibre-gl-shared.mjs: plain public static
  // assets (the MapLibre GL JS Web Worker script and the module it imports, served from
  // public/maplibre/<version>/ — see src/lib/maplibre/config.ts MAPLIBRE_WORKER_URL). Must be
  // fetchable without a session cookie: the worker's own internal request for its script isn't
  // guaranteed to carry auth context the same way a normal page navigation does, and there is
  // nothing tenant/user-specific in either file to protect. Scoped to exactly these two
  // filenames under a `maplibre/<anything-but-a-slash>/` segment — NOT a bare `maplibre/`
  // prefix — so this exemption can never widen into an accidentally-open static path. See
  // src/middleware.test.ts for a proving test (this path 200s with no session; a neighboring
  // non-exempted route still redirects to /login).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.svg|sw.js|manifest.json|maplibre\\/[^/]+\\/maplibre-gl-(?:worker|shared)\\.mjs|uploads|icons|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.gif|.*\\.webp|.*\\.svg|.*\\.ico).*)'],
}
