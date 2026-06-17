import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'

const log = createLogger('delayScoring')

export interface MissionDelayScore {
  missionDate:       string
  tenantId:          string
  address:           string
  clientName:        string | null
  estimatedDurationMin: number
  predictedDelay:    number
  delayProbability:  number
  riskLevel:         'low' | 'medium' | 'high'
}

export async function computeDelayScores(tenantId: string, date: string): Promise<MissionDelayScore[]> {

  const missions = await prisma.mission.findMany({
    where:   { tenantId, date, priority: 1, archived: false },
    select:  { id: true, address: true, clientName: true, estimatedDurationMin: true, latitude: true, longitude: true, type: true },
  })

  if (missions.length === 0) return []

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const metrics = await prisma.interventionMetric.findMany({
    where:   { tenantId, date: { gte: cutoffStr }, isReliable: true },
    select:  { estimatedDurationMin: true, actualDurationMin: true, missionType: true },
  })

  const ratioByType = new Map<string, { sum: number; count: number }>()
  for (const m of metrics) {
    if (!ratioByType.has(m.missionType)) ratioByType.set(m.missionType, { sum: 0, count: 0 })
    const r = ratioByType.get(m.missionType)!
    r.sum   += m.actualDurationMin / Math.max(1, m.estimatedDurationMin)
    r.count += 1
  }

  return missions.map(m => {
    const typeRatio   = ratioByType.get(m.type)
    const avgRatio    = typeRatio ? typeRatio.sum / typeRatio.count : 1.0
    const predictedMin = m.estimatedDurationMin * avgRatio
    const predictedDelay = Math.max(0, predictedMin - m.estimatedDurationMin)
    const delayProb   = Math.min(1, Math.max(0, (avgRatio - 1.0) * 2))

    return {
      missionDate:          date,
      tenantId,
      address:              m.address,
      clientName:           m.clientName,
      estimatedDurationMin: m.estimatedDurationMin,
      predictedDelay:       Math.round(predictedDelay),
      delayProbability:     Math.round(delayProb * 100) / 100,
      riskLevel:            delayProb > 0.6 ? 'high' : delayProb > 0.3 ? 'medium' : 'low',
    }
  })
}

export async function getDelayScoresForDate(tenantId: string, date: string) {
  try {
    return await computeDelayScores(tenantId, date)
  } catch (err) {
    log.error('computeDelayScores failed', { tenantId, date, err: String(err) })
    return []
  }
}
