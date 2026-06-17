import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = getRequestContext(req)
  return NextResponse.json({
    userId:   ctx.userId,
    role:     ctx.role,
    tenantId: ctx.tenantId,
  })
}
