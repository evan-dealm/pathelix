import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'

const MAX_BODY_BYTES = 1024

export async function POST(req: NextRequest): Promise<NextResponse> {

  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Body too large' }, { status: 413 })
  }
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    path:     '/',
    maxAge:   0,
  })
  return response
}
