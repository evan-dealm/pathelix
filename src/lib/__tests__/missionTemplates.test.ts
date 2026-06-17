import { describe, it, expect } from 'vitest'
import { expandTemplate, getNextOccurrence, recurrenceLabel } from '@/lib/missionTemplates'
import type { MissionTemplate } from '@/lib/types'

const baseTemplate: MissionTemplate = {
  id:                   't-1',
  label:                'Test',
  type:                 'POSER',
  address:              '10 rue de Lyon',
  latitude:             45.764,
  longitude:            4.836,
  startDate:            '2026-04-07',
  enabled:              true,
  recurrence:           { kind: 'daily', everyN: 1 },
  clientName:           '',
  estimatedDurationMin: 30,
  maneuverTimeMin:      10,
  wasteTypeLabel:       '',
  binSize:              '',
  accessNotes:          '',
}

describe('expandTemplate — daily', () => {
  it('generates one mission per day in range', () => {
    const results = expandTemplate(
      { ...baseTemplate, recurrence: { kind: 'daily', everyN: 1 } },
      '2026-04-07', '2026-04-09',
    )
    expect(results).toHaveLength(3)
    expect(results[0].date).toBe('2026-04-07')
    expect(results[1].date).toBe('2026-04-08')
    expect(results[2].date).toBe('2026-04-09')
  })

  it('respects everyN=2 (every other day)', () => {
    const results = expandTemplate(
      { ...baseTemplate, recurrence: { kind: 'daily', everyN: 2 } },
      '2026-04-07', '2026-04-13',
    )
    expect(results.map(r => r.date)).toEqual(['2026-04-07', '2026-04-09', '2026-04-11', '2026-04-13'])
  })

  it('returns empty when disabled', () => {
    const results = expandTemplate({ ...baseTemplate, enabled: false }, '2026-04-07', '2026-04-09')
    expect(results).toHaveLength(0)
  })

  it('respects template startDate — skips days before startDate', () => {
    const results = expandTemplate(
      { ...baseTemplate, startDate: '2026-04-08' },
      '2026-04-07', '2026-04-09',
    )
    expect(results.map(r => r.date)).toEqual(['2026-04-08', '2026-04-09'])
  })

  it('respects template endDate — stops at endDate', () => {
    const results = expandTemplate(
      { ...baseTemplate, endDate: '2026-04-08' },
      '2026-04-07', '2026-04-10',
    )
    expect(results.map(r => r.date)).toEqual(['2026-04-07', '2026-04-08'])
  })

  it('returns empty when fromDate > endDate', () => {
    const results = expandTemplate(
      { ...baseTemplate, endDate: '2026-04-06' },
      '2026-04-07', '2026-04-09',
    )
    expect(results).toHaveLength(0)
  })

  it('returns empty for inverted range (from > to)', () => {
    const results = expandTemplate(baseTemplate, '2026-04-09', '2026-04-07')
    expect(results).toHaveLength(0)
  })

  it('builds mission with correct fields from template', () => {
    const tpl = { ...baseTemplate, wasteTypeLabel: 'Gravats', binSize: 'Benne 10m3', priority: 2 as const }
    const results = expandTemplate(tpl, '2026-04-07', '2026-04-07')
    expect(results[0].wasteTypeLabel).toBe('Gravats')
    expect(results[0].binSize).toBe('Benne 10m3')
    expect(results[0].priority).toBe(2)
    expect(results[0].address).toBe('10 rue de Lyon')
  })
})

describe('expandTemplate — weekly', () => {
  it('generates missions only on matching weekdays', () => {

    const results = expandTemplate(
      { ...baseTemplate, recurrence: { kind: 'weekly', weekDays: [2, 4] } },
      '2026-04-07', '2026-04-13',
    )

    expect(results.map(r => r.date)).toContain('2026-04-07')
    expect(results.map(r => r.date)).toContain('2026-04-09')

    results.forEach(r => {
      const day = new Date(r.date + 'T00:00:00').getDay()
      expect([2, 4]).toContain(day)
    })
  })

  it('returns empty when weekDays has no match in range', () => {

    const results = expandTemplate(
      { ...baseTemplate, recurrence: { kind: 'weekly', weekDays: [1] } },
      '2026-04-07', '2026-04-08',
    )
    expect(results).toHaveLength(0)
  })
})

describe('expandTemplate — monthly', () => {
  it('fires on the correct day of month', () => {
    const results = expandTemplate(
      { ...baseTemplate, recurrence: { kind: 'monthly', dayOfMonth: 15 } },
      '2026-04-01', '2026-06-30',
    )
    expect(results.map(r => r.date)).toEqual(['2026-04-15', '2026-05-15', '2026-06-15'])
  })

  it('H16 — skips month if dayOfMonth does not exist (e.g. Feb 31)', () => {
    const results = expandTemplate(
      { ...baseTemplate, startDate: '2026-01-01', recurrence: { kind: 'monthly', dayOfMonth: 31 } },
      '2026-01-01', '2026-03-31',
    )

    expect(results.map(r => r.date)).toEqual(['2026-01-31', '2026-03-31'])
  })
})

describe('getNextOccurrence', () => {
  it('returns null when template is disabled', () => {
    expect(getNextOccurrence({ ...baseTemplate, enabled: false })).toBeNull()
  })

  it('returns null when template is past its endDate', () => {
    expect(getNextOccurrence({ ...baseTemplate, endDate: '2020-01-01' })).toBeNull()
  })

  it('returns next occurrence after given afterDate', () => {
    const next = getNextOccurrence(
      { ...baseTemplate, recurrence: { kind: 'weekly', weekDays: [1] } },
      '2026-04-06',
    )
    expect(next).toBe('2026-04-13')
  })

  it('returns next daily occurrence', () => {
    const next = getNextOccurrence(
      { ...baseTemplate, recurrence: { kind: 'daily', everyN: 1 } },
      '2026-04-07',
    )
    expect(next).toBe('2026-04-08')
  })
})

describe('recurrenceLabel', () => {
  it('daily everyN=1 → "Tous les jours"', () => {
    expect(recurrenceLabel({ kind: 'daily', everyN: 1 })).toBe('Tous les jours')
  })

  it('daily everyN=3 → "Tous les 3 jours"', () => {
    expect(recurrenceLabel({ kind: 'daily', everyN: 3 })).toBe('Tous les 3 jours')
  })

  it('weekly single day → "Chaque lundi"', () => {
    expect(recurrenceLabel({ kind: 'weekly', weekDays: [1] })).toBe('Chaque lundi')
  })

  it('weekly multiple days → sorted, first capitalized', () => {
    const label = recurrenceLabel({ kind: 'weekly', weekDays: [3, 1] })
    expect(label).toBe('Chaque lundi, mercredi')
  })

  it('weekly no days → "Hebdomadaire"', () => {
    expect(recurrenceLabel({ kind: 'weekly', weekDays: [] })).toBe('Hebdomadaire')
  })

  it('monthly → "Le 15 de chaque mois"', () => {
    expect(recurrenceLabel({ kind: 'monthly', dayOfMonth: 15 })).toBe('Le 15 de chaque mois')
  })
})
