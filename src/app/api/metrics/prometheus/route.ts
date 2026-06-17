import { NextRequest, NextResponse } from 'next/server'
import { generatePrometheusMetrics } from '@/lib/prometheus'
import { timingSafeEqual } from 'crypto'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

function tokenOk(stored: string, provided: string): boolean {
  const maxLen = Math.max(stored.length, provided.length, 1)
  const a = Buffer.alloc(maxLen); a.write(stored, 0, 'utf8')
  const b = Buffer.alloc(maxLen); b.write(provided, 0, 'utf8')
  return timingSafeEqual(a, b) && stored.length === provided.length
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const metricsToken = process.env.METRICS_TOKEN ?? ''

  if (metricsToken) {
    const bearer = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
    if (!tokenOk(metricsToken, bearer)) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  } else {
    const token = req.cookies.get(SESSION_COOKIE)?.value ?? null
    const session = token ? await verifySession(token) : null
    if (!session || (session.role !== 'admin' && session.role !== 'superadmin')) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const body = generatePrometheusMetrics()
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  })
}
