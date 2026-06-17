;(process.env as Record<string, string>)['NODE_ENV'] = 'test'

import { describe, it, expect } from 'vitest'
import {
  prismaRowToMission,
  prismaRowToDriver,
  prismaRowToExutoire,
} from '@/lib/prismaMappers'

function validMissionRow(): Record<string, unknown> {
  return {
    id: 'mission-abc-123',
    type: 'POSER',
    date: '2025-06-15',
    address: '12 rue de la Paix, Paris',
    latitude: 48.8698,
    longitude: 2.3322,
    estimatedDurationMin: 30,
    maneuverTimeMin: 5,
    clientName: 'Dupont SA',
    outletName: 'Site Nord',
    wasteTypeLabel: 'Carton',
    binSize: '8m³',
    binSizeM3: 8,
    accessNotes: 'Digicode 1234',
    priority: 1,
    timeWindowOpenMin: 480,
    timeWindowCloseMin: 720,
    linkedExutoireId: 'exu-001',
    archived: false,
  }
}

function validDriverRow(): Record<string, unknown> {
  return {
    id: 'driver-xyz-456',
    firstName: 'Jean',
    lastName: 'Martin',
    sector: 'Nord',
    depotName: 'Dépôt Lyon',
    depotLat: 45.7640,
    depotLng: 4.8357,
    maxBinSizeM3: 10,
    vehicleCapacity: 3,
    archived: false,
  }
}

function validExutoireRow(): Record<string, unknown> {
  return {
    id: 'exu-001',
    name: 'Centre de tri Est',
    address: '100 rue Industrielle, Lyon',
    lat: 45.76,
    lng: 4.84,
    openingHoursOpen: 420,
    openingHoursClose: 1080,
    closedDays: [0, 6],
    acceptedWasteTypes: ['Carton', 'Plastique'],
    serviceTimeMin: 15,
  }
}

describe('prismaRowToMission', () => {
  it('maps id correctly', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.id).toBe('mission-abc-123')
  })

  it('maps type correctly', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.type).toBe('POSER')
  })

  it('maps date correctly', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.date).toBe('2025-06-15')
  })

  it('maps address correctly', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.address).toBe('12 rue de la Paix, Paris')
  })

  it('maps latitude correctly', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.latitude).toBe(48.8698)
  })

  it('maps longitude correctly', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.longitude).toBe(2.3322)
  })

  it('maps estimatedDurationMin correctly', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.estimatedDurationMin).toBe(30)
  })

  it('maps maneuverTimeMin correctly when present', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.maneuverTimeMin).toBe(5)
  })

  it('maneuverTimeMin defaults to 0 when null', () => {
    const row = { ...validMissionRow(), maneuverTimeMin: null }
    const m = prismaRowToMission(row)
    expect(m.maneuverTimeMin).toBe(0)
  })

  it('maneuverTimeMin defaults to 0 when 0', () => {
    const row = { ...validMissionRow(), maneuverTimeMin: 0 }
    const m = prismaRowToMission(row)
    expect(m.maneuverTimeMin).toBe(0)
  })

  it('maps clientName correctly when present', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.clientName).toBe('Dupont SA')
  })

  it('clientName is undefined when null', () => {
    const row = { ...validMissionRow(), clientName: null }
    const m = prismaRowToMission(row)
    expect(m.clientName).toBeUndefined()
  })

  it('clientName is undefined when empty string', () => {
    const row = { ...validMissionRow(), clientName: '' }
    const m = prismaRowToMission(row)
    expect(m.clientName).toBeUndefined()
  })

  it('outletName is undefined when null', () => {
    const row = { ...validMissionRow(), outletName: null }
    const m = prismaRowToMission(row)
    expect(m.outletName).toBeUndefined()
  })

  it('outletName is undefined when empty string', () => {
    const row = { ...validMissionRow(), outletName: '' }
    const m = prismaRowToMission(row)
    expect(m.outletName).toBeUndefined()
  })

  it('wasteTypeLabel is undefined when null', () => {
    const row = { ...validMissionRow(), wasteTypeLabel: null }
    const m = prismaRowToMission(row)
    expect(m.wasteTypeLabel).toBeUndefined()
  })

  it('wasteTypeLabel is undefined when empty string', () => {
    const row = { ...validMissionRow(), wasteTypeLabel: '' }
    const m = prismaRowToMission(row)
    expect(m.wasteTypeLabel).toBeUndefined()
  })

  it('binSize is undefined when null', () => {
    const row = { ...validMissionRow(), binSize: null }
    const m = prismaRowToMission(row)
    expect(m.binSize).toBeUndefined()
  })

  it('binSize is undefined when empty string', () => {
    const row = { ...validMissionRow(), binSize: '' }
    const m = prismaRowToMission(row)
    expect(m.binSize).toBeUndefined()
  })

  it('binSizeM3 is mapped when a number', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.binSizeM3).toBe(8)
  })

  it('binSizeM3 is undefined when null', () => {
    const row = { ...validMissionRow(), binSizeM3: null }
    const m = prismaRowToMission(row)
    expect(m.binSizeM3).toBeUndefined()
  })

  it('binSizeM3 is mapped as a numeric value when a float', () => {

    const row = { ...validMissionRow(), binSizeM3: 3.5 }
    const m = prismaRowToMission(row)
    expect(m.binSizeM3).toBe(3.5)
  })

  it('accessNotes is undefined when null', () => {
    const row = { ...validMissionRow(), accessNotes: null }
    const m = prismaRowToMission(row)
    expect(m.accessNotes).toBeUndefined()
  })

  it('accessNotes is undefined when empty string', () => {
    const row = { ...validMissionRow(), accessNotes: '' }
    const m = prismaRowToMission(row)
    expect(m.accessNotes).toBeUndefined()
  })

  it('linkedExutoireId is undefined when null', () => {
    const row = { ...validMissionRow(), linkedExutoireId: null }
    const m = prismaRowToMission(row)
    expect(m.linkedExutoireId).toBeUndefined()
  })

  it('linkedExutoireId is undefined when empty string', () => {
    const row = { ...validMissionRow(), linkedExutoireId: '' }
    const m = prismaRowToMission(row)
    expect(m.linkedExutoireId).toBeUndefined()
  })

  it('priority 1 is mapped correctly', () => {
    const m = prismaRowToMission({ ...validMissionRow(), priority: 1 })
    expect(m.priority).toBe(1)
  })

  it('priority 2 is mapped correctly', () => {
    const m = prismaRowToMission({ ...validMissionRow(), priority: 2 })
    expect(m.priority).toBe(2)
  })

  it('priority 3 is mapped correctly', () => {
    const m = prismaRowToMission({ ...validMissionRow(), priority: 3 })
    expect(m.priority).toBe(3)
  })

  it('priority 0 maps to undefined', () => {
    const m = prismaRowToMission({ ...validMissionRow(), priority: 0 })
    expect(m.priority).toBeUndefined()
  })

  it('priority 4 maps to undefined', () => {
    const m = prismaRowToMission({ ...validMissionRow(), priority: 4 })
    expect(m.priority).toBeUndefined()
  })

  it('priority null maps to undefined', () => {
    const m = prismaRowToMission({ ...validMissionRow(), priority: null })
    expect(m.priority).toBeUndefined()
  })

  it('timeWindow is set when both openMin and closeMin are present', () => {
    const m = prismaRowToMission(validMissionRow())
    expect(m.timeWindow).toEqual({ openMin: 480, closeMin: 720 })
  })

  it('timeWindow is undefined when openMin is null', () => {
    const row = { ...validMissionRow(), timeWindowOpenMin: null }
    const m = prismaRowToMission(row)
    expect(m.timeWindow).toBeUndefined()
  })

  it('timeWindow is undefined when closeMin is null', () => {
    const row = { ...validMissionRow(), timeWindowCloseMin: null }
    const m = prismaRowToMission(row)
    expect(m.timeWindow).toBeUndefined()
  })

  it('timeWindow is undefined when both are null', () => {
    const row = { ...validMissionRow(), timeWindowOpenMin: null, timeWindowCloseMin: null }
    const m = prismaRowToMission(row)
    expect(m.timeWindow).toBeUndefined()
  })

  it('archived is false when null', () => {
    const row = { ...validMissionRow(), archived: null }
    const m = prismaRowToMission(row)
    expect(m.archived).toBe(false)
  })

  it('archived is true when true', () => {
    const row = { ...validMissionRow(), archived: true }
    const m = prismaRowToMission(row)
    expect(m.archived).toBe(true)
  })

  it('archived is false when false', () => {
    const row = { ...validMissionRow(), archived: false }
    const m = prismaRowToMission(row)
    expect(m.archived).toBe(false)
  })
})

describe('prismaRowToDriver', () => {
  it('maps id correctly', () => {
    const d = prismaRowToDriver(validDriverRow())
    expect(d.id).toBe('driver-xyz-456')
  })

  it('maps firstName correctly', () => {
    const d = prismaRowToDriver(validDriverRow())
    expect(d.firstName).toBe('Jean')
  })

  it('maps lastName correctly', () => {
    const d = prismaRowToDriver(validDriverRow())
    expect(d.lastName).toBe('Martin')
  })

  it('maps sector correctly', () => {
    const d = prismaRowToDriver(validDriverRow())
    expect(d.sector).toBe('Nord')
  })

  it('maps depotName correctly', () => {
    const d = prismaRowToDriver(validDriverRow())
    expect(d.depotName).toBe('Dépôt Lyon')
  })

  it('maps depotLat correctly', () => {
    const d = prismaRowToDriver(validDriverRow())
    expect(d.depotLat).toBe(45.7640)
  })

  it('maps depotLng correctly', () => {
    const d = prismaRowToDriver(validDriverRow())
    expect(d.depotLng).toBe(4.8357)
  })

  it('maps maxBinSizeM3 correctly', () => {
    const d = prismaRowToDriver(validDriverRow())
    expect(d.maxBinSizeM3).toBe(10)
  })

  it('maps vehicleCapacity correctly as integer', () => {
    const d = prismaRowToDriver(validDriverRow())
    expect(d.vehicleCapacity).toBe(3)
  })

  it('vehicleCapacity rounds to integer', () => {
    const row = { ...validDriverRow(), vehicleCapacity: 3.7 }
    const d = prismaRowToDriver(row)
    expect(d.vehicleCapacity).toBe(4)
  })

  it('vehicleCapacity rounds down for .2', () => {
    const row = { ...validDriverRow(), vehicleCapacity: 2.2 }
    const d = prismaRowToDriver(row)
    expect(d.vehicleCapacity).toBe(2)
  })

  it('vehicleCapacity is undefined when null', () => {
    const row = { ...validDriverRow(), vehicleCapacity: null }
    const d = prismaRowToDriver(row)
    expect(d.vehicleCapacity).toBeUndefined()
  })

  it('maxBinSizeM3 is undefined when null', () => {
    const row = { ...validDriverRow(), maxBinSizeM3: null }
    const d = prismaRowToDriver(row)
    expect(d.maxBinSizeM3).toBeUndefined()
  })

  it('archived is false when null', () => {
    const row = { ...validDriverRow(), archived: null }
    const d = prismaRowToDriver(row)
    expect(d.archived).toBe(false)
  })

  it('archived is true when true', () => {
    const row = { ...validDriverRow(), archived: true }
    const d = prismaRowToDriver(row)
    expect(d.archived).toBe(true)
  })

  it('archived is false when false', () => {
    const row = { ...validDriverRow(), archived: false }
    const d = prismaRowToDriver(row)
    expect(d.archived).toBe(false)
  })
})

describe('prismaRowToExutoire', () => {
  it('maps id correctly', () => {
    const e = prismaRowToExutoire(validExutoireRow())
    expect(e.id).toBe('exu-001')
  })

  it('maps name correctly', () => {
    const e = prismaRowToExutoire(validExutoireRow())
    expect(e.name).toBe('Centre de tri Est')
  })

  it('maps address correctly', () => {
    const e = prismaRowToExutoire(validExutoireRow())
    expect(e.address).toBe('100 rue Industrielle, Lyon')
  })

  it('maps lat correctly', () => {
    const e = prismaRowToExutoire(validExutoireRow())
    expect(e.lat).toBe(45.76)
  })

  it('maps lng correctly', () => {
    const e = prismaRowToExutoire(validExutoireRow())
    expect(e.lng).toBe(4.84)
  })

  it('maps openingHoursOpen correctly', () => {
    const e = prismaRowToExutoire(validExutoireRow())
    expect(e.openingHoursOpen).toBe(420)
  })

  it('maps openingHoursClose correctly', () => {
    const e = prismaRowToExutoire(validExutoireRow())
    expect(e.openingHoursClose).toBe(1080)
  })

  it('maps closedDays array correctly (PostgreSQL native array)', () => {
    const e = prismaRowToExutoire(validExutoireRow())
    expect(e.closedDays).toEqual([0, 6])
  })

  it('maps acceptedWasteTypes array correctly (PostgreSQL native array)', () => {
    const e = prismaRowToExutoire(validExutoireRow())
    expect(e.acceptedWasteTypes).toEqual(['Carton', 'Plastique'])
  })

  it('maps serviceTimeMin correctly', () => {
    const e = prismaRowToExutoire(validExutoireRow())
    expect(e.serviceTimeMin).toBe(15)
  })

  it('accepts JSON string for closedDays (SQLite compat)', () => {
    const row = { ...validExutoireRow(), closedDays: '[0, 6]' }
    const e = prismaRowToExutoire(row)
    expect(e.closedDays).toEqual([0, 6])
  })

  it('accepts JSON string for acceptedWasteTypes (SQLite compat)', () => {
    const row = { ...validExutoireRow(), acceptedWasteTypes: '["Carton","Verre"]' }
    const e = prismaRowToExutoire(row)
    expect(e.acceptedWasteTypes).toEqual(['Carton', 'Verre'])
  })

  it('accepts empty array for closedDays', () => {
    const row = { ...validExutoireRow(), closedDays: [] }
    const e = prismaRowToExutoire(row)
    expect(e.closedDays).toEqual([])
  })

  it('accepts empty JSON string "[]" for closedDays', () => {
    const row = { ...validExutoireRow(), closedDays: '[]' }
    const e = prismaRowToExutoire(row)
    expect(e.closedDays).toEqual([])
  })

  it('throws when id is not a string', () => {
    const row = { ...validExutoireRow(), id: 42 }
    expect(() => prismaRowToExutoire(row)).toThrow()
  })

  it('throws when id is null', () => {
    const row = { ...validExutoireRow(), id: null }
    expect(() => prismaRowToExutoire(row)).toThrow()
  })

  it('throws when lat is not a number', () => {
    const row = { ...validExutoireRow(), lat: '45.76' }
    expect(() => prismaRowToExutoire(row)).toThrow()
  })

  it('throws when lat is null', () => {
    const row = { ...validExutoireRow(), lat: null }
    expect(() => prismaRowToExutoire(row)).toThrow()
  })

  it('throws when closedDays is neither array nor string', () => {
    const row = { ...validExutoireRow(), closedDays: 42 }
    expect(() => prismaRowToExutoire(row)).toThrow()
  })

  it('throws when closedDays is null', () => {
    const row = { ...validExutoireRow(), closedDays: null }
    expect(() => prismaRowToExutoire(row)).toThrow()
  })

  it('throws on invalid JSON string for closedDays', () => {
    const row = { ...validExutoireRow(), closedDays: 'not-json' }
    expect(() => prismaRowToExutoire(row)).toThrow()
  })

  it('throws when JSON string for closedDays parses to non-array', () => {
    const row = { ...validExutoireRow(), closedDays: '{"key":"value"}' }
    expect(() => prismaRowToExutoire(row)).toThrow()
  })

  it('throws when acceptedWasteTypes is neither array nor string', () => {
    const row = { ...validExutoireRow(), acceptedWasteTypes: 99 }
    expect(() => prismaRowToExutoire(row)).toThrow()
  })

  it('error message for wrong id type mentions the field name', () => {
    const row = { ...validExutoireRow(), id: 123 }
    expect(() => prismaRowToExutoire(row)).toThrow(/id/)
  })

  it('error message for wrong lat type mentions the field name', () => {
    const row = { ...validExutoireRow(), lat: 'bad' }
    expect(() => prismaRowToExutoire(row)).toThrow(/lat/)
  })
})
