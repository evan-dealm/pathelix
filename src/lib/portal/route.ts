import { NextRequest, NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import { ApiError, type RouteHandler } from '@/lib/api/route'
import { handleApiError } from '@/lib/apiError'
import { createLogger } from '@/lib/logger'
import { requirePortal, type PortalContext } from './auth'

type Handler = RouteHandler

/**
 * Route wrapper of the customer portal: portal session required, body validated, and the
 * handler receives the session (tenant + customer) to scope every query with.
 */
export function portalRoute<B = undefined>(opts: { name: string; schema?: ZodType<B> }, fn: (_c: PortalContext & { req: NextRequest; body: B; params: Record<string, string> }) => Promise<unknown>): Handler {
  const log = createLogger(opts.name)
  return async (req: NextRequest, routeCtx?: { params: Promise<Record<string, string>> }) => {
    try {
      const ctx = await requirePortal(req)
      if (ctx instanceof NextResponse) return ctx
      let body = undefined as B
      if (opts.schema) {
        const parsed = opts.schema.safeParse(await req.json().catch(() => null))
        if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten(), code: 'VALIDATION' }, { status: 422 })
        body = parsed.data
      }
      const params = routeCtx?.params ? await routeCtx.params : {}
      const out = await fn({ ...ctx, req, body, params })
      return out instanceof NextResponse ? out : NextResponse.json(out ?? { ok: true })
    } catch (err) {
      if (err instanceof ApiError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
      return handleApiError(err, log, { route: opts.name })
    }
  }
}
