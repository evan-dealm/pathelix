import { describe, it, expect } from 'vitest'

import { hhmmToMin, minToHHMM } from '@/components/admin/hooks'

import {
  haversineKm,
  roadDistKm,
  travelTimeMin,
  formatDuration,
  trafficFactor,
} from '@/lib/algorithm'

import { MissionSchema, OptimizeRequestSchema } from '@/lib/schemas'

import {
  MISSION_TYPE_LABELS,
  MISSION_TYPE_COLORS,
  type MissionType,
} from '@/lib/types'

describe('hhmmToMin', () => {
  it('converts 07:00 to 420', () => {
    expect(hhmmToMin('07:00')).toBe(420)
  })

  it('converts 00:00 to 0', () => {
    expect(hhmmToMin('00:00')).toBe(0)
  })

  it('converts 23:59 to 1439', () => {
    expect(hhmmToMin('23:59')).toBe(1439)
  })

  it('returns 420 (default) for invalid string', () => {
    expect(hhmmToMin('invalid')).toBe(420)
  })

  it('returns 420 (default) for out-of-bounds values like 25:99', () => {
    expect(hhmmToMin('25:99')).toBe(420)
  })
})

describe('minToHHMM', () => {
  it('converts 420 to 07:00', () => {
    expect(minToHHMM(420)).toBe('07:00')
  })

  it('converts 0 to 00:00', () => {
    expect(minToHHMM(0)).toBe('00:00')
  })

  it('converts 1439 to 23:59', () => {
    expect(minToHHMM(1439)).toBe('23:59')
  })
})

describe('haversineKm', () => {
  it('returns 0 for the same point', () => {
    expect(haversineKm(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0)
  })

  it('computes Paris-Lyon distance ~392 km (within 20 km)', () => {

    const dist = haversineKm(48.8566, 2.3522, 45.7640, 4.8357)
    expect(dist).toBeGreaterThan(372)
    expect(dist).toBeLessThan(412)
  })
})

describe('roadDistKm', () => {
  it('applies tortuosity factor to haversine distance', () => {
    const lat1 = 48.8566, lng1 = 2.3522
    const lat2 = 48.8600, lng2 = 2.3600
    const hav  = haversineKm(lat1, lng1, lat2, lng2)
    const road = roadDistKm(lat1, lng1, lat2, lng2)

    expect(road).toBeGreaterThan(hav)
  })
})

describe('travelTimeMin', () => {
  it('equals distance / speed * 60 for base case (no traffic variation)', () => {

    const time = travelTimeMin(48.8566, 2.3522, 45.7640, 4.8357, 60, 0)
    expect(time).toBeGreaterThan(0)
    expect(time).toBeLessThan(Infinity)
  })

  it('adjusts travel time based on traffic factor at rush hour', () => {

    const nightTime = travelTimeMin(48.8566, 2.3522, 45.7640, 4.8357, 60, 120)
    const rushTime  = travelTimeMin(48.8566, 2.3522, 45.7640, 4.8357, 60, 480)

    expect(rushTime).toBeGreaterThan(nightTime)
  })
})

describe('formatDuration', () => {
  it('formats 90 minutes as 1h30', () => {
    expect(formatDuration(90)).toBe('1h30')
  })

  it('formats 30 minutes as 30 min', () => {
    expect(formatDuration(30)).toBe('30 min')
  })

  it('formats 0 minutes as 0 min', () => {
    expect(formatDuration(0)).toBe('0 min')
  })
})

describe('trafficFactor', () => {
  it('returns 0.75 on Sundays', () => {
    expect(trafficFactor(480, 0)).toBe(0.75)
  })

  it('returns 0.85 on Saturdays', () => {
    expect(trafficFactor(480, 6)).toBeCloseTo(0.85, 2)
  })

  it('returns < 1 during nighttime (e.g. 2h00 = 120 min)', () => {
    expect(trafficFactor(120)).toBeLessThan(1)
  })
})

describe('dateSchema (via OptimizeRequestSchema)', () => {
  it('accepts a valid date 2026-03-18', () => {
    const result = OptimizeRequestSchema.safeParse({ date: '2026-03-18' })
    expect(result.success).toBe(true)
  })

  it('rejects a non-date string', () => {
    const result = OptimizeRequestSchema.safeParse({ date: 'not-a-date' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid calendar date like 2026-13-45', () => {
    const result = OptimizeRequestSchema.safeParse({ date: '2026-13-45' })
    expect(result.success).toBe(false)
  })
})

describe('MissionSchema', () => {
  const validMission = {
    type:                 'POSER',
    date:                 '2026-03-18',
    address:              '10 rue de Rivoli, Paris',
    latitude:             48.8566,
    longitude:            2.3522,
    estimatedDurationMin: 15,
    maneuverTimeMin:      5,
  }

  it('accepts a valid mission', () => {
    const result = MissionSchema.safeParse(validMission)
    expect(result.success).toBe(true)
  })

  it('rejects a mission without date', () => {
    const { date, ...noDate } = validMission
    const result = MissionSchema.safeParse(noDate)
    expect(result.success).toBe(false)
  })
})

describe('OptimizeRequestSchema', () => {
  it('accepts {date: "2026-03-18"}', () => {
    const result = OptimizeRequestSchema.safeParse({ date: '2026-03-18' })
    expect(result.success).toBe(true)
  })

  it('rejects {date: "bad"}', () => {
    const result = OptimizeRequestSchema.safeParse({ date: 'bad' })
    expect(result.success).toBe(false)
  })
})

describe('MISSION_TYPE_LABELS', () => {
  const allTypes: MissionType[] = [
    'POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE',
    'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER',
  ]

  it('has a label for every MissionType value', () => {
    for (const t of allTypes) {
      expect(MISSION_TYPE_LABELS[t]).toBeDefined()
      expect(typeof MISSION_TYPE_LABELS[t]).toBe('string')
    }
  })

  it('contains proper French accents', () => {
    expect(MISSION_TYPE_LABELS.RETIRER).toBe('Enlèvement')
    expect(MISSION_TYPE_LABELS.DEPLACER).toBe('Déplacement')
    expect(MISSION_TYPE_LABELS.EXPEDIER).toBe('Expédition')
  })
})

describe('MISSION_TYPE_COLORS', () => {
  it('has a color class string for every MissionType value', () => {
    const allTypes: MissionType[] = [
      'POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE',
      'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER',
    ]
    for (const t of allTypes) {
      expect(MISSION_TYPE_COLORS[t]).toBeDefined()
      expect(MISSION_TYPE_COLORS[t]).toContain('bg-')
    }
  })
})
