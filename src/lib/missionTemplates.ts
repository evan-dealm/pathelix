import type { Mission, MissionTemplate, RecurrenceRule } from '@/lib/types'

export type { MissionTemplate, RecurrenceRule } from '@/lib/types'

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function nextDay(date: Date): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + 1)
  return next
}

export function expandTemplate(
  template: MissionTemplate,
  fromDate: string,
  toDate:   string,
): Omit<Mission, 'id'>[] {
  if (!template.enabled) return []

  const results: Omit<Mission, 'id'>[] = []

  const effectiveFrom = [fromDate, template.startDate].sort().at(-1) as string

  const rawTo = template.endDate
    ? ([toDate, template.endDate].sort()[0] as string)
    : toDate

  if (effectiveFrom > rawTo) return []

  let cursor = parseDate(effectiveFrom)
  const endDate = parseDate(rawTo)

  const MAX_DAYS = 3660
  let iterations = 0

  while (cursor <= endDate && iterations < MAX_DAYS) {
    iterations++
    const dateStr = formatDate(cursor)

    if (matchesRecurrence(template.recurrence, cursor, template.startDate)) {
      results.push(buildMission(template, dateStr))
    }

    cursor = nextDay(cursor)
  }

  return results
}

export function getNextOccurrence(
  template:  MissionTemplate,
  afterDate?: string,
): string | null {
  if (!template.enabled) return null

  const today = new Date()
  const base  = afterDate
    ? new Date(parseDate(afterDate).getTime() + 86_400_000)
    : today

  const effectiveFrom = [formatDate(base), template.startDate].sort().at(-1) as string
  let cursor = parseDate(effectiveFrom)

  if (template.endDate && formatDate(cursor) > template.endDate) return null

  const MAX_DAYS = 400
  for (let i = 0; i < MAX_DAYS; i++) {
    const dateStr = formatDate(cursor)
    if (template.endDate && dateStr > template.endDate) return null
    if (matchesRecurrence(template.recurrence, cursor, template.startDate)) {
      return dateStr
    }
    cursor = nextDay(cursor)
  }

  return null
}

const DAY_NAMES_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

export function recurrenceLabel(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case 'daily':
      return rule.everyN === 1
        ? 'Tous les jours'
        : `Tous les ${rule.everyN} jours`

    case 'weekly': {
      const names = rule.weekDays
        .slice()
        .sort((a, b) => a - b)
        .map(d => DAY_NAMES_FR[d] ?? `jour ${d}`)
      if (names.length === 0) return 'Hebdomadaire'
      return `Chaque ${names.join(', ')}`
    }

    case 'monthly':
      return `Le ${rule.dayOfMonth} de chaque mois`
  }
}

function matchesRecurrence(
  rule:      RecurrenceRule,
  date:      Date,
  startDate: string,
): boolean {
  switch (rule.kind) {
    case 'daily': {
      const start      = parseDate(startDate)
      const diffMs     = date.getTime() - start.getTime()
      const diffDays   = Math.round(diffMs / 86_400_000)

      if (!rule.everyN || rule.everyN < 1) return diffDays === 0
      return diffDays >= 0 && diffDays % rule.everyN === 0
    }

    case 'weekly':
      return rule.weekDays.includes(date.getDay())

    case 'monthly':

      return date.getDate() === rule.dayOfMonth
  }
}

function buildMission(
  template: MissionTemplate,
  date:     string,
): Omit<Mission, 'id'> {
  return {
    type:                 template.type,
    date,
    address:              template.address,
    latitude:             template.latitude,
    longitude:            template.longitude,
    estimatedDurationMin: template.estimatedDurationMin,
    maneuverTimeMin:      template.maneuverTimeMin,
    clientName:           template.clientName,
    outletName:           template.outletName,
    wasteTypeLabel:       template.wasteTypeLabel,
    binSize:              template.binSize,
    binSizeM3:            template.binSizeM3,
    accessNotes:          template.accessNotes,
    priority:             template.priority,
    timeWindow:           template.timeWindow,
    linkedExutoireId:     template.linkedExutoireId,
  }
}
