import { describe, it, expect } from 'vitest'
import { computeTemplateMatches, type BackfillTemplate, type BackfillMission } from '@/lib/recurringTemplateBackfill'

function makeTemplate(overrides: Partial<BackfillTemplate> = {}): BackfillTemplate {
  return {
    id:         'tpl-1',
    tenantId:   'tenant-1',
    address:    '1 rue Test',
    type:       'POSER',
    clientName: 'Client A',
    startDate:  '2026-01-01',
    endDate:    '2026-01-31',
    recurrence: { kind: 'daily', everyN: 1 },
    ...overrides,
  }
}

function makeMission(overrides: Partial<BackfillMission> = {}): BackfillMission {
  return {
    id:         'm-1',
    tenantId:   'tenant-1',
    date:       '2026-01-05',
    address:    '1 rue Test',
    type:       'POSER',
    clientName: 'Client A',
    ...overrides,
  }
}

describe('computeTemplateMatches (A5 backfill)', () => {
  it('links a mission to the single template whose occurrences and signature match', () => {
    const { assignments, ambiguous, unmatched } = computeTemplateMatches(
      [makeTemplate()],
      [makeMission()],
    )
    expect(assignments.get('m-1')).toBe('tpl-1')
    expect(ambiguous).toBe(0)
    expect(unmatched).toBe(0)
  })

  it('leaves a mission unmatched when no template occurrence covers its date', () => {
    const { assignments, unmatched } = computeTemplateMatches(
      [makeTemplate({ startDate: '2026-02-01', endDate: '2026-02-28' })],
      [makeMission({ date: '2026-01-05' })],
    )
    expect(assignments.has('m-1')).toBe(false)
    expect(unmatched).toBe(1)
  })

  it('leaves a mission unmatched when address/type/clientName do not match', () => {
    const { assignments, unmatched } = computeTemplateMatches(
      [makeTemplate({ address: 'other address' })],
      [makeMission()],
    )
    expect(assignments.has('m-1')).toBe(false)
    expect(unmatched).toBe(1)
  })

  it('leaves a mission unmatched (never guesses) when two templates could both have generated it', () => {
    const { assignments, ambiguous } = computeTemplateMatches(
      [makeTemplate({ id: 'tpl-a' }), makeTemplate({ id: 'tpl-b' })],
      [makeMission()],
    )
    expect(assignments.has('m-1')).toBe(false)
    expect(ambiguous).toBe(1)
  })

  it('never matches across tenants even with an otherwise identical signature', () => {
    const { assignments, unmatched } = computeTemplateMatches(
      [makeTemplate({ tenantId: 'tenant-A' })],
      [makeMission({ tenantId: 'tenant-B' })],
    )
    expect(assignments.has('m-1')).toBe(false)
    expect(unmatched).toBe(1)
  })

  it('skips a template with an invalid recurrence rule without crashing, reports it via callback', () => {
    const invalidCalls: string[] = []
    const { assignments, unmatched } = computeTemplateMatches(
      [makeTemplate({ id: 'tpl-bad', recurrence: { kind: 'weekly', weekDays: [99] } })],
      [makeMission()],
      (templateId) => invalidCalls.push(templateId),
    )
    expect(assignments.has('m-1')).toBe(false)
    expect(unmatched).toBe(1)
    expect(invalidCalls).toEqual(['tpl-bad'])
  })
})
