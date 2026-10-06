export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { checkTenantSuspension } from '@/lib/data/context'
import { isSessionCurrent } from '@/lib/sessionRevocation'
import { getClientIp } from '@/lib/rateLimit'
import { authenticateApiKey, scopeAllows, API_KEY_ROLE } from '@/lib/apiKeyAuth'

const _globalRl = new Map<string, { count: number; resetAt: number }>()
// Requests per minute. Authenticated traffic is counted per user, anonymous traffic per IP: a
// whole office behind one public (NAT) address used to share a single 300/min budget, and one
// admin page load alone issues dozens of calls.
const GLOBAL_RL_MAX_USER = parseInt(process.env.RATE_LIMIT_USER_PER_MIN ?? '600', 10) || 600
const GLOBAL_RL_MAX_ANON = parseInt(process.env.RATE_LIMIT_IP_PER_MIN ?? '300', 10) || 300
const GLOBAL_RL_WINDOW = 60_000
const GLOBAL_RL_CAP    = 10_000
let _lastSweep = 0

function globalRlCheck(key: string, max: number): boolean {
  const now = Date.now()

  // At capacity (many distinct IPs — typically an attack), sweeping the whole map on every request
  // made each request O(cap). Sweep at most once a second; if still full, drop the oldest entries.
  if (_globalRl.size >= GLOBAL_RL_CAP && now - _lastSweep > 1000) {
    _lastSweep = now
    for (const [key, bucket] of _globalRl) {
      if (now > bucket.resetAt) _globalRl.delete(key)
    }
  }
  if (_globalRl.size >= GLOBAL_RL_CAP) {
    let toDrop = Math.ceil(GLOBAL_RL_CAP * 0.1)
    for (const key of _globalRl.keys()) {
      _globalRl.delete(key)
      if (--toDrop <= 0) break
    }
  }

  const bucket = _globalRl.get(key)
  if (!bucket || now > bucket.resetAt) {
    _globalRl.set(key, { count: 1, resetAt: now + GLOBAL_RL_WINDOW })
    return true
  }
  if (bucket.count >= max) return false
  bucket.count++
  return true
}

const PUBLIC_PATHS: Array<string | RegExp> = [
  /^\/$/,  // public landing page (signed-in users are redirected by the page itself)
  '/login',
  /^\/api\/auth\/(?!me)/,
  '/api/health',
  '/api/ready',
  '/api/metrics',
  '/api/status',
  '/status',
  '/help',
  // Customer-facing tracking page + its read endpoint, authenticated by the opaque token itself.
  // POST /api/tracking (link creation) verifies the staff session in the handler.
  '/track',
  '/api/tracking',
  // Page a bin's QR code opens with any camera: number + owner only (src/app/c/[token]).
  '/c',
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

// A logged-in driver may only reach the API surface the driver app actually uses — deny by
// default, so a route that forgets its own role check never exposes tenant-wide data (clients,
// vehicles, costs, settings…) to a driver session. Per-route handlers still enforce ownership
// (own plan, own missions) on top of this.
const DRIVER_API_ALLOWLIST: RegExp[] = [
  /^\/api\/auth\//,
  /^\/api\/driver-plan\/[^/]+$/,
  /^\/api\/driver-status(?:\/update)?$/,
  /^\/api\/driver-scan$/,
  /^\/api\/driver-position$/,
  /^\/api\/driver-photos$/,
  /^\/api\/delivery-proof$/,
  /^\/api\/incidents$/,
  /^\/api\/mission-comments$/,
  /^\/api\/push\/subscribe$/,
  /^\/api\/ai\/ocr$/,
  /^\/api\/ai\/jobs\/[^/]+$/,
  /^\/api\/navigation$/,
  /^\/api\/files\//,
]

function driverMayCall(pathname: string): boolean {
  return DRIVER_API_ALLOWLIST.some(p => p.test(pathname))
}

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

  const requestId      = crypto.randomUUID()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  // Every webhook resolves its tenant from its own secret — a client-supplied x-tenant-id is
  // never trusted anywhere, including on public paths.
  requestHeaders.delete('x-tenant-id')
  requestHeaders.delete('x-user-id')
  requestHeaders.delete('x-user-role')
  requestHeaders.delete('x-tenant-trade')
  requestHeaders.delete('x-driver-ref')

  function withContext(response: NextResponse): NextResponse {
    response.headers.set('x-request-id', requestId)
    return response
  }

  if (isPublic(pathname)) {
    return withContext(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  const token    = request.cookies.get(SESSION_COOKIE)?.value ?? null
  const verified = token ? await verifySession(token) : null

  // Signature check first (cheap, unforgeable without the secret), so the budget can be per user;
  // anything unauthenticated is counted against its IP before any database lookup.
  const rlAllowed = verified
    ? globalRlCheck(`u:${verified.sub}`, GLOBAL_RL_MAX_USER)
    : globalRlCheck(`ip:${getClientIp(request.headers)}`, GLOBAL_RL_MAX_ANON)
  if (!rlAllowed) {
    return withContext(NextResponse.json(
      { error: 'Trop de requêtes. Réessayez dans une minute.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    ))
  }

  // Revoked by a password/role change or user deletion since it was issued (see sessionRevocation.ts).
  const session  = verified && await isSessionCurrent(verified) ? verified : null

  // Programmatic access: X-API-Key instead of a session cookie (API routes only, scope-limited).
  const apiKeyHeader = request.headers.get('x-api-key')
  if (!session && apiKeyHeader && pathname.startsWith('/api/')) {
    const key = await authenticateApiKey(apiKeyHeader)
    if (!key) {
      return withContext(NextResponse.json({ error: 'Clé API invalide, expirée ou révoquée' }, { status: 401 }))
    }
    if (!scopeAllows(key.scopes, request.method, pathname)) {
      return withContext(NextResponse.json({ error: 'Clé API sans le droit requis pour cette opération' }, { status: 403 }))
    }
    const suspended = await checkTenantSuspension(key.tenantId, API_KEY_ROLE)
    if (suspended) return withContext(suspended)
    requestHeaders.set('x-tenant-id', key.tenantId)
    requestHeaders.set('x-user-id',   `apikey:${key.id}`)
    requestHeaders.set('x-user-role', API_KEY_ROLE)
    return withContext(NextResponse.next({ request: { headers: requestHeaders } }))
  }

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
  if (session.driverRef) requestHeaders.set('x-driver-ref', session.driverRef)

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

  if (session.role === 'driver') {
    if (pathname.startsWith('/api/') && !driverMayCall(pathname)) {
      return withContext(NextResponse.json({ error: 'Accès refusé' }, { status: 403 }))
    }
    // The driver app is /driver/<own id>: the profile picker and other drivers' pages are staff tools.
    const ownRef = session.driverRef ?? session.sub
    if (pathname === '/driver' || (pathname.startsWith('/driver/') && pathname !== `/driver/${ownRef}`)) {
      const ownUrl = request.nextUrl.clone()
      ownUrl.pathname = `/driver/${ownRef}`
      return withContext(NextResponse.redirect(ownUrl))
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.svg|sw.js|manifest.json|maplibre\\/[^/]+\\/maplibre-gl-(?:worker|shared)\\.mjs|icons/|(?!api/|uploads/)[^?]*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)'],
}
