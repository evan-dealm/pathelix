import { NextRequest, NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import { getRequestContext } from '@/lib/data/context'
import { hasPermission, type Permission } from '@/lib/permissions'
import { getTenantDb, type TenantDb } from '@/lib/tenantDb'
import { ForeignTenantRefError } from '@/lib/tenantRefs'
import { BlockedUrlError } from '@/lib/outboundUrl'
import { handleApiError } from '@/lib/apiError'
import { createLogger } from '@/lib/logger'
import { metrics, METRIC } from '@/lib/metrics'

/**
 * Standard route wrapper for the business modules (containers, sales, billing, portal admin…):
 * identity from the verified request context, drivers refused unless allowed, permission check,
 * Zod validation of the body before anything touches the database, tenant-scoped client, and one
 * error shape — `{ error: string | zodFlatten, code }` — with Prisma errors mapped.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  constructor(status: number, message: string, code = 'ERROR', details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const notFound = (what = 'Élément') => new ApiError(404, `${what} introuvable`, 'NOT_FOUND')
export const conflict = (message: string, code = 'CONFLICT') => new ApiError(409, message, code)
export const unprocessable = (message: string, code = 'INVALID') => new ApiError(422, message, code)

export interface RouteContext<B> {
  req: NextRequest
  tenantId: string
  userId: string
  role: string
  db: TenantDb
  body: B
  params: Record<string, string>
}

interface RouteOptions<B> {
  /** Name used in logs and metrics (the route path). */
  name: string
  permission?: Permission
  /** Drivers are refused unless explicitly allowed (they also go through the middleware allowlist). */
  allowDriver?: boolean
  schema?: ZodType<B>
  /** `false` for calls that change nothing worth tracing (previews, read markers). */
  audit?: boolean
}

// ─── Audit trail ───────────────────────────────────────────────────────────────
// Every successful change made through a business route is traced: who, what, when, on what.
// Before this, only drivers, missions, users and vehicles were — an invoice could be issued,
// credited or paid, a price changed or an API key's webhook edited without leaving any trace.

const AUDIT_SKIP = /\/(preview|simulate|read|preferences)$/
const SECRET_KEY = /pass|secret|token|key|signature|authorization/i
const SINGULAR: Record<string, string> = {
  invoices: 'invoice', payments: 'payment', quotes: 'quote', orders: 'order', contracts: 'contract', containers: 'container',
  'container-types': 'container_type', clients: 'client', 'client-contacts': 'client_contact', materials: 'material',
  'price-lists': 'price_list', 'price-rules': 'price_rule', weighings: 'weighing', documents: 'document',
  'webhook-endpoints': 'webhook_endpoint', 'webhook-deliveries': 'webhook_delivery', 'portal-requests': 'portal_request',
  'portal-users': 'portal_user', 'maintenance-plans': 'maintenance_plan', 'vehicle-defects': 'vehicle_defect',
  'vehicle-unavailability': 'vehicle_unavailability', missions: 'mission',
}
const VERB: Record<string, string> = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }

/** `POST /api/invoices/[id]/issue` → `invoice.issue`; `PUT /api/quotes/[id]` → `quote.update`. */
export function auditActionOf(method: string, routeName: string): { action: string; entityType: string } {
  const parts = routeName.replace(/^\/api\//, '').split('/')
  const resource = SINGULAR[parts[0]] ?? parts[0].replace(/s$/, '').replace(/-/g, '_')
  const last = parts[parts.length - 1]
  const sub = parts.length > 1 && !last.startsWith('[') ? last.replace(/-/g, '_') : null
  const entityType = resource.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  return { action: `${resource}.${sub ?? VERB[method] ?? method.toLowerCase()}`, entityType }
}

/** What was sent, without secrets and without long texts — enough to understand the change. */
function auditChanges(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) { out[k] = '[masqué]'; continue }
    if (typeof v === 'string') out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v
    else if (Array.isArray(v)) out[k] = `[${v.length} élément(s)]`
    else out[k] = '{…}'
  }
  return out
}

function recordAudit<B>(opts: RouteOptions<B>, method: string, tenantId: string, userId: string, params: Record<string, string>, body: B, out: unknown): void {
  if (method === 'GET' || method === 'HEAD' || opts.audit === false || AUDIT_SKIP.test(opts.name)) return
  if (process.env.USE_MOCK_DATA !== 'false') return
  const { action, entityType } = auditActionOf(method, opts.name)
  const result = (out && typeof out === 'object' ? out : {}) as Record<string, unknown>
  const nested = Object.values(result).find(v => v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') as { id: string } | undefined
  const entityId = params.id ?? (typeof result.id === 'string' ? result.id : nested?.id) ?? ''
  const number = typeof result.number === 'string' ? { number: result.number } : {}
  const db = getTenantDb(tenantId)
  void db.auditLog.create({
    data: { userId: userId || 'system', action, entityType, entityId, changes: { ...auditChanges(body), ...number } } as Parameters<typeof db.auditLog.create>[0]['data'],
  }).catch(() => undefined) // the trace must never fail the action it traces
}

/**
 * What a route file exports. Next validates the second parameter of every exported handler at
 * build time and refuses one typed optional (`next build` failed on "undefined is not assignable
 * to RouteContext" for every route built with this wrapper). It reads the last signature, which
 * takes the context; the first one keeps direct one-argument calls (tests) valid.
 */
export interface RouteHandler {
  (_req: NextRequest): Promise<NextResponse>
  (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }): Promise<NextResponse>
}
type Handler = RouteHandler

// Compile-time guard (`npm run typecheck`): fails if the context parameter Next reads becomes
// optional again — the production build would break without any test noticing.
type SecondParameter<F> = F extends (..._args: infer A) => unknown ? A[1] : never
export const ROUTE_CONTEXT_IS_REQUIRED: undefined extends SecondParameter<RouteHandler>
  ? never
  : true = true

export function apiRoute<B = undefined>(
  opts: RouteOptions<B>,
  fn: (_ctx: RouteContext<B>) => Promise<unknown>,
): Handler {
  const log = createLogger(opts.name)
  return async (req: NextRequest, routeCtx?: { params: Promise<Record<string, string>> }) => {
    const t0 = Date.now()
    let status = 200
    try {
      const { tenantId, role, userId } = getRequestContext(req)
      if (role === 'driver' && !opts.allowDriver) {
        status = 403
        return NextResponse.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, { status })
      }
      // The body is read before anything else is awaited. Behind the middleware, a body of
      // ~100 KB or more that is read only after another await is intermittently lost by the
      // framework ("Response body object should not be disturbed or locked"): about one request
      // in ten then answered an HTML 500 page — saving many routes at once could fail at random.
      let rawText: string | null = null
      if (opts.schema) rawText = await req.text().catch(() => null)
      if (opts.permission && !(await hasPermission(userId, role, opts.permission))) {
        status = 403
        return NextResponse.json({ error: 'Permission refusée', code: 'FORBIDDEN' }, { status })
      }
      let body = undefined as B
      if (opts.schema) {
        let raw: unknown
        try {
          if (rawText === null) throw new Error('unreadable body')
          raw = JSON.parse(rawText)
        } catch {
          status = 400
          return NextResponse.json({ error: 'Corps JSON invalide', code: 'BAD_JSON' }, { status })
        }
        const parsed = opts.schema.safeParse(raw)
        if (!parsed.success) {
          status = 422
          return NextResponse.json(
            { error: parsed.error.flatten(), code: 'VALIDATION' },
            { status },
          )
        }
        body = parsed.data
      }
      const params = routeCtx?.params ? await routeCtx.params : {}
      const out = await fn({ req, tenantId, userId, role, db: getTenantDb(tenantId), body, params })
      if (out instanceof NextResponse) {
        status = out.status
        if (status < 400) recordAudit(opts, req.method, tenantId, userId, params, body, undefined)
        return out
      }
      recordAudit(opts, req.method, tenantId, userId, params, body, out)
      return NextResponse.json(out ?? { ok: true })
    } catch (err) {
      if (err instanceof ApiError) {
        status = err.status
        return NextResponse.json(
          {
            error: err.message,
            code: err.code,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
          { status },
        )
      }
      if (err instanceof BlockedUrlError) {
        status = 422
        return NextResponse.json(
          { error: `URL refusée : ${err.message}`, code: 'BLOCKED_URL' },
          { status },
        )
      }
      if (err instanceof ForeignTenantRefError) {
        status = 422
        return NextResponse.json({ error: err.message, code: 'FOREIGN_REF' }, { status })
      }
      const res = handleApiError(err, log, { route: opts.name, method: req.method })
      status = res.status
      return res
    } finally {
      metrics.histogram(METRIC.API_LATENCY_MS, Date.now() - t0, {
        route: opts.name,
        method: req.method,
      })
      metrics.increment(METRIC.API_REQUESTS, {
        route: opts.name,
        method: req.method,
        status: String(status),
      })
      if (status >= 500)
        metrics.increment(METRIC.API_ERRORS, { route: opts.name, type: 'server_error' })
    }
  }
}

/** `?page=&limit=` with bounds (limit ≤ 100). */
export function pagination(
  req: NextRequest,
  defaultLimit = 50,
): { page: number; limit: number; skip: number } {
  const p = req.nextUrl.searchParams
  const page = Math.max(1, parseInt(p.get('page') ?? '1', 10) || 1)
  const limit = Math.min(
    100,
    Math.max(1, parseInt(p.get('limit') ?? String(defaultLimit), 10) || defaultLimit),
  )
  return { page, limit, skip: (page - 1) * limit }
}

export function paged<T>(data: T[], total: number, page: number, limit: number) {
  return { data, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }
}

/** A `?sort=field` / `?sort=-field` restricted to an allow-list, for Prisma `orderBy`. */
export function sortParam<F extends string>(
  req: NextRequest,
  allowed: readonly F[],
  fallback: F,
  fallbackDir: 'asc' | 'desc' = 'asc',
): Record<F, 'asc' | 'desc'> {
  const raw = req.nextUrl.searchParams.get('sort') ?? ''
  const desc = raw.startsWith('-')
  const field = (desc ? raw.slice(1) : raw) as F
  if (allowed.includes(field))
    return { [field]: desc ? 'desc' : 'asc' } as Record<F, 'asc' | 'desc'>
  return { [fallback]: fallbackDir } as Record<F, 'asc' | 'desc'>
}
