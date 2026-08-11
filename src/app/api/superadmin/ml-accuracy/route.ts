import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getRequestContext } from '@/lib/data/context'

interface AccuracyStats {
  sampleCount: number
  mape: number          // Mean Absolute Percentage Error (%)
  medianErrorMin: number // Median signed error (actual - estimated, minutes)
  meanErrorMin: number   // Mean signed error (bias)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function computeStats(rows: Array<{ estimatedDurationMin: number; actualDurationMin: number }>): AccuracyStats {
  if (rows.length === 0) return { sampleCount: 0, mape: 0, medianErrorMin: 0, meanErrorMin: 0 }

  const errors    = rows.map(r => r.actualDurationMin - r.estimatedDurationMin)
  const absPcts   = rows.map(r => Math.abs(r.actualDurationMin - r.estimatedDurationMin) / r.estimatedDurationMin * 100)
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length
  const mape      = absPcts.reduce((a, b) => a + b, 0) / absPcts.length

  return {
    sampleCount:    rows.length,
    mape:           Math.round(mape * 10) / 10,
    medianErrorMin: Math.round(median(errors) * 10) / 10,
    meanErrorMin:   Math.round(meanError * 10) / 10,
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const tenantId = searchParams.get('tenantId') ?? undefined

  const raw = await prisma.interventionMetric.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      isReliable: true,
      estimatedDurationMin: { gt: 0 },
    },
    select: {
      tenantId:             true,
      missionType:          true,
      driverId:             true,
      siteId:               true,
      estimatedDurationMin: true,
      actualDurationMin:    true,
    },
    orderBy: { tenantId: 'asc' },
  })

  // Global (all tenants or filtered tenant)
  const globalStats = computeStats(raw)

  // By missionType
  const byType = new Map<string, typeof raw>()
  for (const r of raw) {
    const list = byType.get(r.missionType) ?? []
    list.push(r)
    byType.set(r.missionType, list)
  }

  // By driver (top 20 by sample count)
  const byDriver = new Map<string, typeof raw>()
  for (const r of raw) {
    const list = byDriver.get(r.driverId) ?? []
    list.push(r)
    byDriver.set(r.driverId, list)
  }

  // By site (top 20 by sample count)
  const bySite = new Map<string, typeof raw>()
  for (const r of raw) {
    if (!r.siteId) continue
    const list = bySite.get(r.siteId) ?? []
    list.push(r)
    bySite.set(r.siteId, list)
  }

  const topDrivers = [...byDriver.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20)
    .map(([driverId, rows]) => ({ driverId, ...computeStats(rows) }))

  const topSites = [...bySite.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20)
    .map(([siteId, rows]) => ({ siteId, ...computeStats(rows) }))

  return NextResponse.json({
    tenantFilter: tenantId ?? null,
    totalMetrics: raw.length,
    global: globalStats,
    byMissionType: Object.fromEntries(
      [...byType.entries()].map(([type, rows]) => [type, computeStats(rows)])
    ),
    topDriversByError: topDrivers,
    topSitesByError:   topSites,
    interpretation: {
      mape:           'MAPE < 20% = bon, 20-40% = acceptable, > 40% = ML insuffisamment calibré',
      medianErrorMin: 'Biais systématique : positif = sous-estimations (chauffeurs plus lents), négatif = surestimations',
      howToRead:      'Filtrer par tenantId pour un diagnostic par client. topDriversByError identifie les profils outliers.',
    },
  })
}
