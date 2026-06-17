import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'

const log = createLogger('demandPrediction')

export interface DemandPrediction {
  siteId:          string
  siteName:        string
  clientName:      string
  address:         string
  latitude:        number
  longitude:       number
  predictedDate:   string
  confidence:      number
  avgIntervalDays: number
  lastCollectDate: string
  wasteType?:      string
}

export async function predictDemand(
  tenantId: string,
  horizonDays: number = 7,
): Promise<DemandPrediction[]> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  const lookbackDate = new Date(now)
  lookbackDate.setDate(lookbackDate.getDate() - 90)
  const lookback = lookbackDate.toISOString().slice(0, 10)

  const horizonDate = new Date(now)
  horizonDate.setDate(horizonDate.getDate() + horizonDays)
  const horizon = horizonDate.toISOString().slice(0, 10)

  try {

    const missions = await prisma.mission.findMany({
      where: {
        tenantId,
        type: { in: ['RETIRER', 'ECHANGER'] },
        date: { gte: lookback },
        archived: false,
      },
      select: {
        siteId: true,
        clientName: true,
        address: true,
        latitude: true,
        longitude: true,
        date: true,
        wasteTypeLabel: true,
      },
      orderBy: { date: 'asc' },
    })

    const bySite = new Map<string, typeof missions>()
    for (const m of missions) {
      if (!m.siteId) continue
      const list = bySite.get(m.siteId) ?? []
      list.push(m)
      bySite.set(m.siteId, list)
    }

    const predictions: DemandPrediction[] = []

    for (const [siteId, siteMissions] of bySite) {
      if (siteMissions.length < 2) continue

      const uniqueDates = [...new Set(siteMissions.map(m => m.date))].sort()
      if (uniqueDates.length < 2) continue

      const intervals: number[] = []
      for (let i = 1; i < uniqueDates.length; i++) {
        const prev = new Date(uniqueDates[i - 1] + 'T12:00:00Z')
        const curr = new Date(uniqueDates[i] + 'T12:00:00Z')
        const days = Math.round((curr.getTime() - prev.getTime()) / 86400_000)
        if (days > 0 && days < 90) intervals.push(days)
      }

      if (intervals.length === 0) continue

      intervals.sort((a, b) => a - b)
      const mid = Math.floor(intervals.length / 2)
      const medianInterval = intervals.length % 2 === 1
        ? intervals[mid]
        : Math.round((intervals[mid - 1] + intervals[mid]) / 2)

      const lastDate = uniqueDates[uniqueDates.length - 1]
      const lastDateObj = new Date(lastDate + 'T12:00:00Z')
      const predictedDateObj = new Date(lastDateObj)
      predictedDateObj.setDate(predictedDateObj.getDate() + medianInterval)
      const predictedDate = predictedDateObj.toISOString().slice(0, 10)

      if (predictedDate < today || predictedDate > horizon) continue

      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 1
      const confidence = Math.max(0.1, Math.min(1, 1 - cv * 0.8))

      const ref = siteMissions[siteMissions.length - 1]
      predictions.push({
        siteId,
        siteName: siteId,
        clientName: ref.clientName ?? '',
        address: ref.address,
        latitude: ref.latitude,
        longitude: ref.longitude,
        predictedDate,
        confidence: Math.round(confidence * 100) / 100,
        avgIntervalDays: Math.round(medianInterval),
        lastCollectDate: lastDate,
        wasteType: ref.wasteTypeLabel ?? undefined,
      })
    }

    if (predictions.length > 0) {
      const siteIds = predictions.map(p => p.siteId)
      const sites = await prisma.site.findMany({
        where: { id: { in: siteIds }, tenantId },
        select: { id: true, name: true },
      })
      const siteNames = new Map(sites.map(s => [s.id, s.name]))
      for (const p of predictions) {
        p.siteName = siteNames.get(p.siteId) ?? p.siteId
      }
    }

    predictions.sort((a, b) => a.predictedDate.localeCompare(b.predictedDate) || b.confidence - a.confidence)

    log.info('Demand predictions generated', { tenantId, count: predictions.length, horizon: horizonDays })
    return predictions
  } catch (err) {
    log.error('Demand prediction failed', { err: err instanceof Error ? err.message : String(err) })
    return []
  }
}
