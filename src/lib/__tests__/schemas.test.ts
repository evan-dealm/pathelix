import { describe, it, expect } from 'vitest'
import {
  MissionSchema,
  DriverSchema,
  ExutoireSchema,
  OptimizeRequestSchema,
  PlanSchema,
  LoginSchema,
} from '../schemas'

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

  it('accepts a mission with all optional fields', () => {
    const result = MissionSchema.safeParse({
      ...validMission,
      clientName:       'Acme Corp',
      outletName:       'Point A',
      wasteTypeLabel:   'Encombrants',
      binSize:          '30m3',
      binSizeM3:        30,
      accessNotes:      'Portail code 1234',
      priority:         1,
      timeWindow:       { openMin: 480, closeMin: 720 },
      linkedExutoireId: 'ex-1',
      archived:         false,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid mission type', () => {
    const result = MissionSchema.safeParse({ ...validMission, type: 'INVALID' })
    expect(result.success).toBe(false)
  })

  it('rejects latitude out of range', () => {
    const result = MissionSchema.safeParse({ ...validMission, latitude: 91 })
    expect(result.success).toBe(false)
  })

  it('rejects latitude below -90', () => {
    const result = MissionSchema.safeParse({ ...validMission, latitude: -91 })
    expect(result.success).toBe(false)
  })

  it('rejects longitude out of range (> 180)', () => {
    const result = MissionSchema.safeParse({ ...validMission, longitude: 181 })
    expect(result.success).toBe(false)
  })

  it('rejects longitude out of range (< -180)', () => {
    const result = MissionSchema.safeParse({ ...validMission, longitude: -181 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid date format', () => {
    const result = MissionSchema.safeParse({ ...validMission, date: '18/03/2026' })
    expect(result.success).toBe(false)
  })

  it('rejects date with wrong separator', () => {
    const result = MissionSchema.safeParse({ ...validMission, date: '2026.03.18' })
    expect(result.success).toBe(false)
  })

  it('rejects timeWindow where closeMin <= openMin', () => {
    const result = MissionSchema.safeParse({
      ...validMission,
      timeWindow: { openMin: 720, closeMin: 480 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects timeWindow where closeMin == openMin', () => {
    const result = MissionSchema.safeParse({
      ...validMission,
      timeWindow: { openMin: 480, closeMin: 480 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing required fields', () => {
    const result = MissionSchema.safeParse({ type: 'POSER' })
    expect(result.success).toBe(false)
  })

  it('rejects empty address', () => {
    const result = MissionSchema.safeParse({ ...validMission, address: '' })
    expect(result.success).toBe(false)
  })

  it('rejects negative estimatedDurationMin', () => {
    const result = MissionSchema.safeParse({ ...validMission, estimatedDurationMin: -5 })
    expect(result.success).toBe(false)
  })

  it('accepts priority values 1, 2, 3', () => {
    for (const p of [1, 2, 3]) {
      const result = MissionSchema.safeParse({ ...validMission, priority: p })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid priority value', () => {
    const result = MissionSchema.safeParse({ ...validMission, priority: 4 })
    expect(result.success).toBe(false)
  })
})

describe('DriverSchema', () => {
  const validDriver = {
    firstName: 'Jean',
    lastName:  'Dupont',
    sector:    'Nord',
    depotName: 'Dépôt Nord',
    depotLat:  45.764,
    depotLng:  4.836,
  }

  it('accepts a valid driver', () => {
    const result = DriverSchema.safeParse(validDriver)
    expect(result.success).toBe(true)
  })

  it('rejects empty firstName', () => {
    const result = DriverSchema.safeParse({ ...validDriver, firstName: '' })
    expect(result.success).toBe(false)
  })

  it('rejects missing sector', () => {
    const { sector, ...rest } = validDriver
    void sector
    const result = DriverSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects depotLat out of range', () => {
    const result = DriverSchema.safeParse({ ...validDriver, depotLat: 95 })
    expect(result.success).toBe(false)
  })
})

describe('ExutoireSchema', () => {
  const validExutoire = {
    name:              'Exutoire Nord',
    address:           '1 rue du Tri',
    lat:               45.76,
    lng:               4.83,
    openingHoursOpen:  360,
    openingHoursClose: 1080,
    closedDays:        [0],
    acceptedWasteTypes: ['Encombrants'],
    serviceTimeMin:    10,
  }

  it('accepts a valid exutoire', () => {
    const result = ExutoireSchema.safeParse(validExutoire)
    expect(result.success).toBe(true)
  })

  it('rejects closedDays with invalid day numbers', () => {
    const result = ExutoireSchema.safeParse({ ...validExutoire, closedDays: [7] })
    expect(result.success).toBe(false)
  })
})

describe('OptimizeRequestSchema', () => {
  it('accepts minimal valid request', () => {
    const result = OptimizeRequestSchema.safeParse({ date: '2026-03-18' })
    expect(result.success).toBe(true)
  })

  it('accepts full request with options', () => {
    const result = OptimizeRequestSchema.safeParse({
      date:      '2026-03-18',
      driverIds: ['d-1', 'd-2'],
      existingPlans: { 'd-1': ['m-1', 'm-2'] },
      options: {
        timeBudgetMs:    8000,
        seed:            42,
        lnsIterations:   80,
        lnsDestroyRatio: 0.3,
        verboseLog:      false,
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid date format', () => {
    const result = OptimizeRequestSchema.safeParse({ date: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('rejects destroyRatio > 1', () => {
    const result = OptimizeRequestSchema.safeParse({
      date:    '2026-03-18',
      options: { lnsDestroyRatio: 1.5 },
    })
    expect(result.success).toBe(false)
  })
})

describe('PlanSchema', () => {
  it('accepts a valid plan', () => {
    const result = PlanSchema.safeParse({
      driverId: 'd-1',
      date:     '2026-03-18',
      missions: [{
        id:                   'm-1',
        type:                 'POSER',
        date:                 '2026-03-18',
        address:              'Test',
        latitude:             45.76,
        longitude:            4.83,
        estimatedDurationMin: 15,
        maneuverTimeMin:      5,
        sequenceOrder:        1,
      }],
      startTime: '07:00',
      speedKmh:  50,
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty driverId', () => {
    const result = PlanSchema.safeParse({
      driverId: '',
      date:     '2026-03-18',
      missions: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('LoginSchema', () => {
  it('accepts password only', () => {
    const result = LoginSchema.safeParse({ password: 'admin' })
    expect(result.success).toBe(true)
  })

  it('accepts password + email', () => {
    const result = LoginSchema.safeParse({ password: 'test', email: 'user@example.com' })
    expect(result.success).toBe(true)
  })

  it('rejects empty password', () => {
    const result = LoginSchema.safeParse({ password: '' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email format', () => {
    const result = LoginSchema.safeParse({ password: 'test', email: 'not-an-email' })
    expect(result.success).toBe(false)
  })
})
