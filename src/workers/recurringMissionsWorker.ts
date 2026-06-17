#!/usr/bin/env tsx

import { Worker, Queue, Job }                 from 'bullmq'
import { RRule }                               from 'rrule'
import { createLogger }                       from '@/lib/logger'
import { getRedisClient }                     from '@/lib/redisClient'
import { MissionType }                        from '@/generated/prisma'
import prisma                                 from '@/lib/db'

const log = createLogger('recurringMissionsWorker')

const QUEUE_NAME   = 'recurring-missions'
const LOOKAHEAD_DAYS = 7

interface RecurrenceRule {
  kind:       'daily' | 'weekly' | 'monthly'
  everyN?:    number
  weekDays?:  number[]
  dayOfMonth?: number
}

function toRRule(rule: RecurrenceRule, startDate: Date, endDate: Date | null): RRule {
  const opts: ConstructorParameters<typeof RRule>[0] = {
    dtstart: startDate,
    until:   endDate ?? undefined,
  }

  if (rule.kind === 'daily') {
    opts.freq     = RRule.DAILY
    opts.interval = rule.everyN ?? 1
  } else if (rule.kind === 'weekly') {
    opts.freq    = RRule.WEEKLY
    const DAYS   = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA]
    opts.byweekday = (rule.weekDays ?? [1]).map(d => DAYS[d])
  } else {
    opts.freq     = RRule.MONTHLY
    opts.bymonthday = rule.dayOfMonth ?? 1
  }

  return new RRule(opts)
}

async function processRecurringMissions(_job: Job) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + LOOKAHEAD_DAYS)

  const templates = await prisma.missionTemplate.findMany({
    where: { enabled: true },
  })

  log.info('Processing recurring missions', { templates: templates.length, horizon: horizon.toISOString().split('T')[0] })

  let created = 0, skipped = 0

  for (const tpl of templates) {
    const recurrence = tpl.recurrence as unknown as RecurrenceRule
    const startDate  = new Date(tpl.startDate)
    const endDate    = tpl.endDate ? new Date(tpl.endDate) : null

    let rrule: RRule
    try {
      rrule = toRRule(recurrence, startDate, endDate)
    } catch (err) {
      log.warn('Invalid recurrence rule', { templateId: tpl.id, err: String(err) })
      continue
    }

    const occurrences = rrule.between(today, horizon, true)

    for (const occ of occurrences) {
      const dateStr = occ.toISOString().split('T')[0]

      const existing = await prisma.mission.findFirst({
        where: {
          tenantId:   tpl.tenantId,
          date:       dateStr,
          address:    tpl.address,
          type:       tpl.type as MissionType,
          clientName: tpl.clientName || undefined,
        },
        select: { id: true },
      })

      if (existing) { skipped++; continue }

      await prisma.mission.create({
        data: {
          tenantId:            tpl.tenantId,
          type:                tpl.type as MissionType,
          date:                dateStr,
          address:             tpl.address,
          latitude:            tpl.latitude,
          longitude:           tpl.longitude,
          clientName:          tpl.clientName || undefined,
          estimatedDurationMin: tpl.estimatedDurationMin,
          maneuverTimeMin:     tpl.maneuverTimeMin,
          wasteTypeLabel:      tpl.wasteTypeLabel || undefined,
          binSize:             tpl.binSize || undefined,
          binSizeM3:           tpl.binSizeM3 ?? undefined,
          accessNotes:         tpl.accessNotes || undefined,
          priority:            tpl.priority ?? undefined,
          timeWindowOpenMin:   (tpl.timeWindow as { openMin?: number } | null)?.openMin,
          timeWindowCloseMin:  (tpl.timeWindow as { closeMin?: number } | null)?.closeMin,
          linkedExutoireId:    tpl.linkedExutoireId ?? undefined,
          notes:               `[Auto] Template: ${tpl.label}`,
        },
      })
      created++
    }
  }

  log.info('Recurring missions done', { created, skipped })
  return { created, skipped }
}

async function main() {
  const redis = await getRedisClient()
  if (!redis) { log.error('Redis unavailable — recurring worker cannot start'); process.exit(1) }

  const connection = { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379', 10) || 6379 }

  const queue = new Queue(QUEUE_NAME, { connection })

  await queue.add('generate', {}, {
    repeat:   { pattern: '0 1 * * *' },
    jobId:    'recurring-daily',
    removeOnComplete: 10,
    removeOnFail:     5,
  })

  await queue.add('generate-now', {}, { removeOnComplete: 1 })

  const worker = new Worker(QUEUE_NAME, processRecurringMissions, {
    connection,
    concurrency: 1,
  })

  worker.on('completed', job => log.info('Job completed', { id: job.id, result: job.returnvalue }))
  worker.on('failed',    (job, err) => log.error('Job failed', { id: job?.id, err: err.message }))

  log.info('Recurring missions worker started (CRON 01:00 daily)')
}

main().catch(err => { log.error('Worker crashed', { err: err instanceof Error ? err.message : String(err) }); process.exit(1) })
