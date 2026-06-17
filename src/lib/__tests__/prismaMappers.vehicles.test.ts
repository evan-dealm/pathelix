import { describe, it, expect } from 'vitest'
import { prismaRowToExutoire } from '../prismaMappers'

describe('prismaRowToExutoire', () => {
  const baseRow = {
    id: 'exu-1',
    name: 'Centre de tri',
    address: 'ZI Rumilly',
    lat: 45.867,
    lng: 5.944,
    openingHoursOpen: 360,
    openingHoursClose: 1080,
    closedDays: [0, 6],
    acceptedWasteTypes: ['DIB', 'Gravats', 'Bois'],
    serviceTimeMin: 15,
  }

  it('mappe tous les champs correctement', () => {
    const exu = prismaRowToExutoire(baseRow)
    expect(exu.id).toBe('exu-1')
    expect(exu.name).toBe('Centre de tri')
    expect(exu.lat).toBeCloseTo(45.867)
    expect(exu.lng).toBeCloseTo(5.944)
    expect(exu.openingHoursOpen).toBe(360)
    expect(exu.openingHoursClose).toBe(1080)
    expect(exu.closedDays).toEqual([0, 6])
    expect(exu.acceptedWasteTypes).toEqual(['DIB', 'Gravats', 'Bois'])
    expect(exu.serviceTimeMin).toBe(15)
  })

  it('closedDays tableau vide → tableau vide', () => {
    const exu = prismaRowToExutoire({ ...baseRow, closedDays: [] })
    expect(exu.closedDays).toEqual([])
  })

  it('closedDays null → throw (champ obligatoire)', () => {
    expect(() => prismaRowToExutoire({ ...baseRow, closedDays: null })).toThrow()
  })

  it('acceptedWasteTypes tableau vide → tableau vide', () => {
    const exu = prismaRowToExutoire({ ...baseRow, acceptedWasteTypes: [] })
    expect(exu.acceptedWasteTypes).toEqual([])
  })

  it('serviceTimeMin 0 est accepté', () => {
    const exu = prismaRowToExutoire({ ...baseRow, serviceTimeMin: 0 })
    expect(exu.serviceTimeMin).toBe(0)
  })

  it('gère les string[] depuis JSON string (Prisma)', () => {
    const exu = prismaRowToExutoire({
      ...baseRow,
      acceptedWasteTypes: '["DIB","Ferraille"]',
    })
    expect(exu.acceptedWasteTypes).toEqual(['DIB', 'Ferraille'])
  })
})
