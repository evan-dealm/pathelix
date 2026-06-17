#!/usr/bin/env tsx

import { Worker, Queue, Job }                 from 'bullmq'
import { createLogger }                       from '@/lib/logger'
import { getRedisClient }                     from '@/lib/redisClient'
import { broadcastIncident }                  from '@/lib/incidentBroadcast'
import prisma                                 from '@/lib/db'

const log = createLogger('anomalyDetectionWorker')
const QUEUE_NAME = 'anomaly-detection'
const STALL_THRESHOLD_MIN = 45
const DETOUR_THRESHOLD_KM = 15

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6371
  const dL = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a  = Math.sin(dL / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function detectAnomalies(_job: Job) {
  const now  = new Date()
  const today = now.toISOString().split('T')[0]

  const plans = await prisma.plan.findMany({
    where:  { date: today },
    select: { tenantId: true, driverId: true, missions: true },
  })

  let anomalies = 0

  for (const plan of plans) {

    const cutoff = new Date(now.getTime() - 5 * 60 * 1000)
    const pos    = await prisma.driverPosition.findFirst({
      where:   { driverId: plan.driverId, recordedAt: { gte: cutoff } },
      orderBy: { recordedAt: 'desc' },
    })
    if (!pos) continue

    const stallCutoff = new Date(now.getTime() - STALL_THRESHOLD_MIN * 60 * 1000)
    const oldPos      = await prisma.driverPosition.findFirst({
      where:   { driverId: plan.driverId, recordedAt: { gte: stallCutoff } },
      orderBy: { recordedAt: 'asc' },
    })

    if (oldPos) {
      const dist = haversine(oldPos.latitude, oldPos.longitude, pos.latitude, pos.longitude)
      if (dist < 0.1) {
        broadcastIncident(plan.tenantId, {
          missionId:    `driver:${plan.driverId}`,
          incidentType: 'anomalie_arret',
          notes:        `Chauffeur arrêté depuis ${STALL_THRESHOLD_MIN}+ min`,
          address:      `${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}`,
          clientName:   '',
          reportedBy:   'system:anomaly',
          reportedAt:   now.toISOString(),
        })
        anomalies++
      }
    }

    const missionsArr = (plan.missions as Array<{ latitude?: number; longitude?: number; sequenceOrder?: number }> | null) ?? []
    if (missionsArr.length > 0) {
      const nextMission = missionsArr.sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0))[0]
      if (nextMission.latitude && nextMission.longitude) {
        const dist = haversine(pos.latitude, pos.longitude, nextMission.latitude, nextMission.longitude)
        if (dist > DETOUR_THRESHOLD_KM) {
          broadcastIncident(plan.tenantId, {
            missionId:    `driver:${plan.driverId}`,
            incidentType: 'anomalie_detour',
            notes:        `Chauffeur à ${dist.toFixed(1)} km de sa prochaine mission`,
            address:      `${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}`,
            clientName:   '',
            reportedBy:   'system:anomaly',
            reportedAt:   now.toISOString(),
          })
          anomalies++
        }
      }
    }
  }

  log.info('Anomaly detection cycle done', { plans: plans.length, anomalies })
  return { anomalies }
}

async function main() {
  const redis = await getRedisClient()
  if (!redis) { log.error('Redis unavailable'); process.exit(1) }

  const connection = { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379', 10) || 6379 }
  const queue = new Queue(QUEUE_NAME, { connection })

  await queue.add('detect', {}, {
    repeat:           { every: 2 * 60 * 1000 },
    jobId:            'anomaly-detect',
    removeOnComplete: 5,
    removeOnFail:     3,
  })

  const worker = new Worker(QUEUE_NAME, detectAnomalies, { connection, concurrency: 1 })

  worker.on('completed', job => log.info('Detection done', { id: job.id, result: job.returnvalue }))
  worker.on('failed',    (job, err) => log.error('Detection failed', { id: job?.id, err: err.message }))

  log.info('Anomaly detection worker started (every 2 min)')
}

main().catch(err => { log.error('Worker crashed', { err: err instanceof Error ? err.message : String(err) }); process.exit(1) })
