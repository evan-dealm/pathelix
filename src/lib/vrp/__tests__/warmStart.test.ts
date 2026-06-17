import { describe, it, expect } from 'vitest'
import { buildWarmStartFromReference } from '@/lib/vrp/warmStart'
import type { Mission } from '@/lib/types'

function makeMission(
  id: string,
  type: Mission['type'] = 'VIDER',
  siteId?: string,
  clientId?: string,
): Mission {
  return {
    id,
    type,
    date:                 '2026-03-24',
    address:              'Annecy',
    latitude:             45.8992,
    longitude:            6.1294,
    estimatedDurationMin: 30,
    maneuverTimeMin:      5,
    ...(siteId   ? { siteId }   : {}),
    ...(clientId ? { clientId } : {}),
  }
}

type RefEntry = {
  missionId: string
  siteId?: string
  clientId?: string
  type: string
  driverId: string
}

function ref(
  missionId: string,
  type: string,
  driverId: string,
  siteId?: string,
  clientId?: string,
): RefEntry {
  return { missionId, type, driverId, ...(siteId ? { siteId } : {}), ...(clientId ? { clientId } : {}) }
}

describe('buildWarmStartFromReference — empty inputs', () => {
  it('returns empty existingPlans and newMissions for no missions and no reference', () => {
    const { existingPlans, newMissions } = buildWarmStartFromReference([], [])
    expect(existingPlans).toEqual({})
    expect(newMissions).toHaveLength(0)
  })

  it('puts all missions in newMissions when reference is empty', () => {
    const missions = [makeMission('m1'), makeMission('m2')]
    const { existingPlans, newMissions } = buildWarmStartFromReference(missions, [])
    expect(Object.keys(existingPlans)).toHaveLength(0)
    expect(newMissions.map(m => m.id)).toEqual(['m1', 'm2'])
  })

  it('returns empty newMissions when missions list is empty', () => {
    const refPlan = [ref('old1', 'VIDER', 'd1', 'site-a')]
    const { newMissions } = buildWarmStartFromReference([], refPlan)
    expect(newMissions).toHaveLength(0)
  })

  it('returns empty existingPlans when missions list is empty', () => {
    const refPlan = [ref('old1', 'VIDER', 'd1', 'site-a')]
    const { existingPlans } = buildWarmStartFromReference([], refPlan)
    expect(existingPlans).toEqual({})
  })
})

describe('buildWarmStartFromReference — siteId matching', () => {
  it('places mission in existingPlans when siteId + type matches', () => {
    const missions = [makeMission('m1', 'VIDER', 'site-a')]
    const refPlan  = [ref('old1', 'VIDER', 'd1', 'site-a')]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)
    expect(existingPlans['d1']).toContain('m1')
  })

  it('matched mission is NOT in newMissions', () => {
    const missions = [makeMission('m1', 'VIDER', 'site-a')]
    const refPlan  = [ref('old1', 'VIDER', 'd1', 'site-a')]
    const { newMissions } = buildWarmStartFromReference(missions, refPlan)
    expect(newMissions.map(m => m.id)).not.toContain('m1')
  })

  it('unmatched mission remains in newMissions', () => {
    const missions = [makeMission('m1', 'VIDER', 'site-a'), makeMission('m2', 'VIDER', 'site-z')]
    const refPlan  = [ref('old1', 'VIDER', 'd1', 'site-a')]
    const { newMissions } = buildWarmStartFromReference(missions, refPlan)
    expect(newMissions.map(m => m.id)).toContain('m2')
  })

  it('does not match when type differs even if siteId matches', () => {
    const missions = [makeMission('m1', 'POSER', 'site-a')]
    const refPlan  = [ref('old1', 'VIDER', 'd1', 'site-a')]
    const { existingPlans, newMissions } = buildWarmStartFromReference(missions, refPlan)
    expect(Object.keys(existingPlans)).toHaveLength(0)
    expect(newMissions.map(m => m.id)).toContain('m1')
  })
})

describe('buildWarmStartFromReference — clientId fallback matching', () => {
  it('places mission in existingPlans when clientId + type matches (no siteId)', () => {
    const missions = [makeMission('m1', 'VIDER', undefined, 'client-a')]
    const refPlan  = [ref('old1', 'VIDER', 'd1', undefined, 'client-a')]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)
    expect(existingPlans['d1']).toContain('m1')
  })

  it('clientId-matched mission is NOT in newMissions', () => {
    const missions = [makeMission('m1', 'VIDER', undefined, 'client-a')]
    const refPlan  = [ref('old1', 'VIDER', 'd1', undefined, 'client-a')]
    const { newMissions } = buildWarmStartFromReference(missions, refPlan)
    expect(newMissions.map(m => m.id)).not.toContain('m1')
  })

  it('siteId match takes priority over clientId match', () => {

    const missions = [makeMission('m1', 'VIDER', 'site-a', 'client-a')]
    const refPlan  = [ref('old1', 'VIDER', 'd1', 'site-a')]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)

    expect(existingPlans['d1']).toContain('m1')
  })

  it('falls back to clientId when siteId not present in mission', () => {
    const missions = [makeMission('m1', 'VIDER', undefined, 'client-a')]
    const refPlan  = [
      ref('old1', 'VIDER', 'd1', 'site-x', 'client-a'),
    ]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)
    expect(existingPlans['d1']).toContain('m1')
  })
})

describe('buildWarmStartFromReference — multiple drivers', () => {
  it('splits missions across drivers correctly', () => {
    const missions = [
      makeMission('m1', 'VIDER', 'site-a'),
      makeMission('m2', 'VIDER', 'site-b'),
    ]
    const refPlan = [
      ref('old1', 'VIDER', 'd1', 'site-a'),
      ref('old2', 'VIDER', 'd2', 'site-b'),
    ]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)
    expect(existingPlans['d1']).toContain('m1')
    expect(existingPlans['d2']).toContain('m2')
    expect(existingPlans['d1']).not.toContain('m2')
  })

  it('3 drivers, 6 missions: 2 matched per driver', () => {
    const missions = [
      makeMission('m1', 'VIDER', 'site-a1'),
      makeMission('m2', 'VIDER', 'site-a2'),
      makeMission('m3', 'VIDER', 'site-b1'),
      makeMission('m4', 'VIDER', 'site-b2'),
      makeMission('m5', 'VIDER', 'site-c1'),
      makeMission('m6', 'VIDER', 'site-c2'),
    ]
    const refPlan = [
      ref('r1', 'VIDER', 'd1', 'site-a1'),
      ref('r2', 'VIDER', 'd1', 'site-a2'),
      ref('r3', 'VIDER', 'd2', 'site-b1'),
      ref('r4', 'VIDER', 'd2', 'site-b2'),
      ref('r5', 'VIDER', 'd3', 'site-c1'),
      ref('r6', 'VIDER', 'd3', 'site-c2'),
    ]
    const { existingPlans, newMissions } = buildWarmStartFromReference(missions, refPlan)
    expect(existingPlans['d1']).toHaveLength(2)
    expect(existingPlans['d2']).toHaveLength(2)
    expect(existingPlans['d3']).toHaveLength(2)
    expect(newMissions).toHaveLength(0)
  })
})

describe('buildWarmStartFromReference — duplicate sites', () => {
  it('uses different mission ids for two reference entries at the same site', () => {
    const missions = [
      makeMission('m1', 'VIDER', 'site-a'),
      makeMission('m2', 'VIDER', 'site-a'),
    ]
    const refPlan = [
      ref('old1', 'VIDER', 'd1', 'site-a'),
      ref('old2', 'VIDER', 'd1', 'site-a'),
    ]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)
    const ids = existingPlans['d1'] ?? []
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('does not reuse the same mission id across two reference entries', () => {
    const missions = [
      makeMission('m1', 'VIDER', 'site-a'),
      makeMission('m2', 'VIDER', 'site-a'),
    ]
    const refPlan = [
      ref('old1', 'VIDER', 'd1', 'site-a'),
      ref('old2', 'VIDER', 'd2', 'site-a'),
    ]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)
    const allIds = [...(existingPlans['d1'] ?? []), ...(existingPlans['d2'] ?? [])]
    expect(new Set(allIds).size).toBe(allIds.length)
  })
})

describe('buildWarmStartFromReference — driverId requirement', () => {
  it('skips reference entries without driverId', () => {
    const missions = [makeMission('m1', 'VIDER', 'site-a')]
    const refPlan: RefEntry[] = [
      { missionId: 'old1', type: 'VIDER', driverId: '', siteId: 'site-a' },
    ]
    const { existingPlans, newMissions } = buildWarmStartFromReference(missions, refPlan)
    expect(Object.keys(existingPlans)).toHaveLength(0)
    expect(newMissions.map(m => m.id)).toContain('m1')
  })
})

describe('buildWarmStartFromReference — ordering', () => {
  it('preserves reference order in existingPlans', () => {
    const missions = [
      makeMission('m1', 'VIDER', 'site-a'),
      makeMission('m2', 'VIDER', 'site-b'),
      makeMission('m3', 'VIDER', 'site-c'),
    ]
    const refPlan = [
      ref('r1', 'VIDER', 'd1', 'site-a'),
      ref('r2', 'VIDER', 'd1', 'site-b'),
      ref('r3', 'VIDER', 'd1', 'site-c'),
    ]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)
    expect(existingPlans['d1']).toEqual(['m1', 'm2', 'm3'])
  })

  it('newMissions does not include any matched mission', () => {
    const missions = [
      makeMission('m1', 'VIDER', 'site-a'),
      makeMission('m2', 'VIDER', 'site-b'),
      makeMission('m3', 'VIDER'),
    ]
    const refPlan = [
      ref('r1', 'VIDER', 'd1', 'site-a'),
      ref('r2', 'VIDER', 'd1', 'site-b'),
    ]
    const { newMissions } = buildWarmStartFromReference(missions, refPlan)
    expect(newMissions.map(m => m.id)).toEqual(['m3'])
  })
})

describe('buildWarmStartFromReference — return types', () => {
  it('existingPlans values are arrays of strings', () => {
    const missions = [makeMission('m1', 'VIDER', 'site-a')]
    const refPlan  = [ref('r1', 'VIDER', 'd1', 'site-a')]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)
    const ids = existingPlans['d1']
    expect(Array.isArray(ids)).toBe(true)
    ids.forEach(id => expect(typeof id).toBe('string'))
  })

  it('newMissions contains Mission objects with id field', () => {
    const missions = [makeMission('m1', 'VIDER')]
    const { newMissions } = buildWarmStartFromReference(missions, [])
    expect(newMissions[0]).toHaveProperty('id', 'm1')
  })

  it('existingPlans is a plain object (not a Map)', () => {
    const { existingPlans } = buildWarmStartFromReference([], [])
    expect(typeof existingPlans).toBe('object')
    expect(existingPlans instanceof Map).toBe(false)
  })
})

describe('buildWarmStartFromReference — siteId vs clientId priority', () => {
  it('mission with both siteId and clientId prefers siteId match', () => {
    const missions = [makeMission('m1', 'VIDER', 'site-a', 'client-a')]
    const refPlan  = [
      ref('r1', 'VIDER', 'd1', 'site-a'),
      ref('r2', 'VIDER', 'd2', undefined, 'client-a'),
    ]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)

    expect(existingPlans['d1']).toContain('m1')

    expect((existingPlans['d2'] ?? []).includes('m1')).toBe(false)
  })

  it('falls back to clientId when siteId reference does not match mission siteId', () => {
    const missions = [makeMission('m1', 'VIDER', 'site-z', 'client-a')]
    const refPlan  = [ref('r1', 'VIDER', 'd2', undefined, 'client-a')]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)
    expect(existingPlans['d2']).toContain('m1')
  })
})

describe('buildWarmStartFromReference — no matches', () => {
  it('returns empty existingPlans when no missions match any reference entry', () => {
    const missions = [makeMission('m1', 'VIDER', 'site-x')]
    const refPlan  = [ref('r1', 'VIDER', 'd1', 'site-y')]
    const { existingPlans } = buildWarmStartFromReference(missions, refPlan)
    expect(Object.keys(existingPlans)).toHaveLength(0)
  })

  it('all missions in newMissions when none match', () => {
    const missions = [makeMission('m1', 'VIDER', 'site-x'), makeMission('m2', 'VIDER', 'site-y')]
    const refPlan  = [ref('r1', 'VIDER', 'd1', 'site-z')]
    const { newMissions } = buildWarmStartFromReference(missions, refPlan)
    expect(newMissions.map(m => m.id).sort()).toEqual(['m1', 'm2'])
  })
})
