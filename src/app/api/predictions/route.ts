import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/data/context'
import { predictDemand } from '@/lib/demandPrediction'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  const days = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10)))

  try {
    const predictions = await predictDemand(tenantId, days)
    return NextResponse.json({ predictions })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
