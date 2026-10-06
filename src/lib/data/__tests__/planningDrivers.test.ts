import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => { process.env.USE_MOCK_DATA = 'false' })

const db = vi.hoisted(() => ({
  driver: { findMany: vi.fn() },
  driverUnavailability: { findMany: vi.fn() },
  vehicleUnavailability: { findMany: vi.fn() },
  maintenancePlan: { findMany: vi.fn() },
  vehicleDefect: { findMany: vi.fn() },
}))
vi.mock('@/lib/tenantDb', () => ({ getTenantDb: () => db }))

import { getPlanningDrivers } from '../planning'

const DAY = '2026-10-06'
const truck = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: 'active', archived: false, maxBins: 1, weightTon: 26, heightM: 4, widthM: 2.55, lengthM: 10, axleCount: 3,
  hazmat: false, tareKg: null, payloadKg: null, licensePlate: `PL-${id}`, mileageKm: 100_000, nextInspection: null, insuranceExpiry: null, ...extra,
})
const driver = (id: string, vehicles: unknown[], extra: Record<string, unknown> = {}) => ({
  id, firstName: 'Chauffeur', lastName: id, sector: '', depotName: '', depotLat: 45.19, depotLng: 5.72, maxBinSizeM3: null,
  vehicleCapacity: null, notes: '', skills: [], weeklyHoursMax: null, phone: '', archived: false, startingExutoireId: null,
  email: null, employeeNumber: null, hiredAt: null, birthDate: null, licenseExpiry: null, licenseCategories: [], emergencyContact: null,
  color: null, vehicles, ...extra,
})

beforeEach(() => {
  for (const m of Object.values(db)) m.findMany.mockReset().mockResolvedValue([])
})

describe('getPlanningDrivers — immobilised trucks and invalid licences are never proposed', () => {
  it('keeps a driver whose truck is in order', async () => {
    db.driver.findMany.mockResolvedValue([driver('d1', [truck('v1')])])
    const r = await getPlanningDrivers('t1', DAY)
    expect(r.drivers.map(d => d.id)).toEqual(['d1'])
    expect(r.excluded).toEqual([])
  })

  it('excludes a driver whose only truck has an open critical defect', async () => {
    db.driver.findMany.mockResolvedValue([driver('d1', [truck('v1')])])
    db.vehicleDefect.findMany.mockResolvedValue([{ vehicleId: 'v1', severity: 'CRITICAL', status: 'OPEN', description: 'Freins' }])
    const r = await getPlanningDrivers('t1', DAY)
    expect(r.drivers).toEqual([])
    expect(r.excluded[0]).toMatchObject({ driverId: 'd1', reason: 'VEHICLE_UNAVAILABLE', detail: 'PL-v1 : défaut bloquant : Freins' })
  })

  it('switches to the second truck when the first one has an overdue technical inspection', async () => {
    db.driver.findMany.mockResolvedValue([driver('d1', [truck('v1'), truck('v2')])])
    db.maintenancePlan.findMany.mockResolvedValue([{ vehicleId: 'v1', kind: 'CT', label: 'Contrôle technique', everyKm: null, everyMonths: 12, lastDoneAt: '2025-09-01', lastDoneKm: null, dueDate: null, warnDays: 30, warnKm: 1500, active: true }])
    const r = await getPlanningDrivers('t1', DAY)
    expect(r.drivers).toHaveLength(1)
    expect(r.excluded).toEqual([])
  })

  it('excludes on expired insurance recorded on the vehicle itself', async () => {
    db.driver.findMany.mockResolvedValue([driver('d1', [truck('v1', { insuranceExpiry: '2026-09-30' })])])
    const r = await getPlanningDrivers('t1', DAY)
    expect(r.excluded[0].detail).toMatch(/assurance expirée le 30\/09\/2026/)
  })

  it('excludes a driver whose licence has expired', async () => {
    db.driver.findMany.mockResolvedValue([driver('d1', [truck('v1')], { licenseExpiry: new Date('2026-10-01T00:00:00Z') })])
    const r = await getPlanningDrivers('t1', DAY)
    expect(r.excluded[0]).toMatchObject({ reason: 'DRIVER_UNAVAILABLE', detail: 'permis expiré le 01/10/2026' })
  })
})
