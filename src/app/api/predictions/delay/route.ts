import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext }         from '@/lib/data/context'
import { getDelayScoresForDate }     from '@/lib/delayScoring'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)
  const date         = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  const scores = await getDelayScoresForDate(tenantId, date)
  return NextResponse.json({ scores, date })
}
