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
  req:      NextRequest
  tenantId: string
  userId:   string
  role:     string
  db:       TenantDb
  body:     B
  params:   Record<string, string>
}

interface RouteOptions<B> {
  /** Name used in logs and metrics (the route path). */
  name:         string
  permission?:  Permission
  /** Drivers are refused unless explicitly allowed (they also go through the middleware allowlist). */
  allowDriver?: boolean
  schema?:      ZodType<B>
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
export const ROUTE_CONTEXT_IS_REQUIRED: undefined extends SecondParameter<RouteHandler> ? never : true = true

export function apiRoute<B = undefined>(opts: RouteOptions<B>, fn: (_ctx: RouteContext<B>) => Promise<unknown>): Handler {
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
      if (opts.permission && !(await hasPermission(userId, role, opts.permission))) {
        status = 403
        return NextResponse.json({ error: 'Permission refusée', code: 'FORBIDDEN' }, { status })
      }
      let body = undefined as B
      if (opts.schema) {
        let raw: unknown
        try { raw = await req.json() } catch {
          status = 400
          return NextResponse.json({ error: 'Corps JSON invalide', code: 'BAD_JSON' }, { status })
        }
        const parsed = opts.schema.safeParse(raw)
        if (!parsed.success) {
          status = 422
          return NextResponse.json({ error: parsed.error.flatten(), code: 'VALIDATION' }, { status })
        }
        body = parsed.data
      }
      const params = routeCtx?.params ? await routeCtx.params : {}
      const out = await fn({ req, tenantId, userId, role, db: getTenantDb(tenantId), body, params })
      if (out instanceof NextResponse) { status = out.status; return out }
      return NextResponse.json(out ?? { ok: true })
    } catch (err) {
      if (err instanceof ApiError) {
        status = err.status
        return NextResponse.json({ error: err.message, code: err.code, ...(err.details !== undefined ? { details: err.details } : {}) }, { status })
      }
      if (err instanceof BlockedUrlError) {
        status = 422
        return NextResponse.json({ error: `URL refusée : ${err.message}`, code: 'BLOCKED_URL' }, { status })
      }
      if (err instanceof ForeignTenantRefError) {
        status = 422
        return NextResponse.json({ error: err.message, code: 'FOREIGN_REF' }, { status })
      }
      const res = handleApiError(err, log, { route: opts.name, method: req.method })
      status = res.status
      return res
    } finally {
      metrics.histogram(METRIC.API_LATENCY_MS, Date.now() - t0, { route: opts.name, method: req.method })
      metrics.increment(METRIC.API_REQUESTS, { route: opts.name, method: req.method, status: String(status) })
      if (status >= 500) metrics.increment(METRIC.API_ERRORS, { route: opts.name, type: 'server_error' })
    }
  }
}

/** `?page=&limit=` with bounds (limit ≤ 100). */
export function pagination(req: NextRequest, defaultLimit = 50): { page: number; limit: number; skip: number } {
  const p = req.nextUrl.searchParams
  const page = Math.max(1, parseInt(p.get('page') ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(p.get('limit') ?? String(defaultLimit), 10) || defaultLimit))
  return { page, limit, skip: (page - 1) * limit }
}

export function paged<T>(data: T[], total: number, page: number, limit: number) {
  return { data, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }
}

/** A `?sort=field` / `?sort=-field` restricted to an allow-list, for Prisma `orderBy`. */
export function sortParam<F extends string>(req: NextRequest, allowed: readonly F[], fallback: F, fallbackDir: 'asc' | 'desc' = 'asc'): Record<F, 'asc' | 'desc'> {
  const raw = req.nextUrl.searchParams.get('sort') ?? ''
  const desc = raw.startsWith('-')
  const field = (desc ? raw.slice(1) : raw) as F
  if (allowed.includes(field)) return { [field]: desc ? 'desc' : 'asc' } as Record<F, 'asc' | 'desc'>
  return { [fallback]: fallbackDir } as Record<F, 'asc' | 'desc'>
}
