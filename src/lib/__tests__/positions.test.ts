import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TenantDb } from '@/lib/tenantDb'
import { latestPositions, speedHistory } from '../positions'

type Row = { driverId: string; latitude?: number; longitude?: number; speedKmh: number | null; recordedAt: Date }
const findMany = vi.fn(async (_args: unknown) => [] as Row[])
const db = { driverPosition: { findMany } } as unknown as TenantDb

beforeEach(() => { vi.clearAllMocks() })

describe('latestPositions', () => {
  it('asks the database for the newest row of each driver since the cut-off', async () => {
    const since = new Date('2026-10-07T00:00:00Z')
    await latestPositions(db, { since })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recordedAt: { gte: since } },
      orderBy: { recordedAt: 'desc' },
      distinct: ['driverId'],
    }))
  })

  it('restricts to the requested drivers', async () => {
    await latestPositions(db, { since: new Date(0), driverIds: ['d1'] })
    const args = findMany.mock.calls[0][0] as { where: { driverId?: unknown } }
    expect(args.where.driverId).toEqual({ in: ['d1'] })
  })

  it('maps rows to the shape the live map reads; a stopped truck has ignition off', async () => {
    const at = new Date('2026-10-07T08:30:00Z')
    findMany.mockResolvedValueOnce([
      { driverId: 'd1', latitude: 45.9, longitude: 6.1, speedKmh: 42, recordedAt: at },
      { driverId: 'd2', latitude: 46, longitude: 6.2, speedKmh: null, recordedAt: at },
    ])
    expect(await latestPositions(db, { since: new Date(0) })).toEqual([
      { driverId: 'd1', lat: 45.9, lng: 6.1, speedKmh: 42, ignition: true, updatedAt: at.getTime() },
      { driverId: 'd2', lat: 46, lng: 6.2, speedKmh: 0, ignition: false, updatedAt: at.getTime() },
    ])
  })
})

describe('speedHistory', () => {
  it('plots minutes on the tenant clock, not the server clock (07:15 UTC is 09:15 in Paris in summer)', async () => {
    findMany.mockResolvedValueOnce([{ driverId: 'd1', speedKmh: 50, recordedAt: new Date('2026-07-01T07:15:20Z') }])
    expect(await speedHistory(db, '2026-07-01', 'Europe/Paris')).toEqual({ d1: [{ minuteOfDay: 9 * 60 + 15, speedKmh: 50 }] })
  })

  it('keeps the readings of the local day only: 23:30 UTC the day before is 01:30 local, 22:30 UTC is tomorrow', async () => {
    findMany.mockResolvedValueOnce([
      { driverId: 'd1', speedKmh: 30, recordedAt: new Date('2026-06-30T21:30:00Z') }, // 23:30 on 30 June → out
      { driverId: 'd1', speedKmh: 31, recordedAt: new Date('2026-06-30T23:30:00Z') }, // 01:30 on 1 July → in
      { driverId: 'd1', speedKmh: 32, recordedAt: new Date('2026-07-01T22:30:00Z') }, // 00:30 on 2 July → out
    ])
    expect(await speedHistory(db, '2026-07-01', 'Europe/Paris')).toEqual({ d1: [{ minuteOfDay: 90, speedKmh: 31 }] })
  })

  it('keeps the last reading of each minute, sorted, per driver', async () => {
    findMany.mockResolvedValueOnce([
      { driverId: 'd1', speedKmh: 10, recordedAt: new Date('2026-01-15T08:00:05Z') },
      { driverId: 'd2', speedKmh: 70, recordedAt: new Date('2026-01-15T08:00:10Z') },
      { driverId: 'd1', speedKmh: 20, recordedAt: new Date('2026-01-15T08:00:45Z') },
      { driverId: 'd1', speedKmh: 0, recordedAt: new Date('2026-01-15T08:01:00Z') },
    ])
    expect(await speedHistory(db, '2026-01-15', 'Europe/Paris')).toEqual({
      d1: [{ minuteOfDay: 9 * 60, speedKmh: 20 }, { minuteOfDay: 9 * 60 + 1, speedKmh: 0 }],
      d2: [{ minuteOfDay: 9 * 60, speedKmh: 70 }],
    })
  })

  it('queries a window wide enough for any time zone and never unbounded', async () => {
    await speedHistory(db, '2026-07-01', 'Europe/Paris', ['d1'])
    const args = findMany.mock.calls[0][0] as { where: { recordedAt: { gte: Date; lt: Date }; driverId: unknown }; take: number }
    expect(args.where.recordedAt.gte.getTime()).toBeLessThanOrEqual(Date.parse('2026-06-30T22:00:00Z'))
    expect(args.where.recordedAt.lt.getTime()).toBeGreaterThanOrEqual(Date.parse('2026-07-01T22:00:00Z'))
    expect(args.where.driverId).toEqual({ in: ['d1'] })
    expect(args.take).toBeGreaterThan(0)
  })

  it('falls back to Paris time on an unknown zone instead of failing the map', async () => {
    findMany.mockResolvedValueOnce([{ driverId: 'd1', speedKmh: 50, recordedAt: new Date('2026-07-01T07:15:00Z') }])
    expect(await speedHistory(db, '2026-07-01', 'Not/AZone')).toEqual({ d1: [{ minuteOfDay: 9 * 60 + 15, speedKmh: 50 }] })
  })

  it('returns nothing for a malformed date without querying', async () => {
    expect(await speedHistory(db, 'nope', 'Europe/Paris')).toEqual({})
    expect(findMany).not.toHaveBeenCalled()
  })
})
