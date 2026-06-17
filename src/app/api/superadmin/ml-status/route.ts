import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getRequestContext } from '@/lib/data/context'

const ML_MATURITY_THRESHOLD = 500

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  }

  const metricCounts = await prisma.interventionMetric.groupBy({
    by: ['tenantId', 'isReliable'],
    _count: true,
  })

  const profiles = await prisma.tenantMLProfile.groupBy({
    by: ['tenantId'],
    _count: true,
    _max: { lastComputedAt: true },
  })

  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true, plan: true },
  })

  const profileMap = new Map(profiles.map(p => [p.tenantId, p]))

  const countsByTenant = new Map<string, { total: number; reliable: number; rejected: number }>()
  for (const row of metricCounts) {
    const entry = countsByTenant.get(row.tenantId) ?? { total: 0, reliable: 0, rejected: 0 }
    entry.total += row._count
    if (row.isReliable) { entry.reliable += row._count }
    else { entry.rejected += row._count }
    countsByTenant.set(row.tenantId, entry)
  }

  const result = tenants.map(tenant => {
    const counts  = countsByTenant.get(tenant.id) ?? { total: 0, reliable: 0, rejected: 0 }
    const profile = profileMap.get(tenant.id)

    const maturityPct = Math.min(100, Math.round((counts.reliable / ML_MATURITY_THRESHOLD) * 100))

    let maturityLabel: string
    if (maturityPct === 0)         maturityLabel = 'Aucune donnée'
    else if (maturityPct < 30)     maturityLabel = 'Apprentissage'
    else if (maturityPct < 70)     maturityLabel = 'Coefficients partiels'
    else if (maturityPct < 100)    maturityLabel = 'Calibration avancée'
    else                           maturityLabel = 'Calibration complète'

    return {
      tenantId:          tenant.id,
      tenantName:        tenant.name,
      tenantSlug:        tenant.slug,
      tenantPlan:        tenant.plan,
      metrics: {
        total:           counts.total,
        reliable:        counts.reliable,
        rejected:        counts.rejected,
        rejectionRate:   counts.total > 0 ? Math.round((counts.rejected / counts.total) * 100) : 0,
      },
      maturity: {
        pct:             maturityPct,
        label:           maturityLabel,
        threshold:       ML_MATURITY_THRESHOLD,
      },
      profile: {
        coefficientCount: profile?._count ?? 0,
        lastComputedAt:   profile?._max.lastComputedAt?.toISOString() ?? null,
      },
    }
  })

  return NextResponse.json(result)
}
