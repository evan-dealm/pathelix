import { describe, it, expect, vi, beforeEach } from 'vitest'

// The SQL itself (latest row per driver, local-day grouping, tenant isolation) is exercised on a
// real PostgreSQL by .manualtest/positions-flow.ts; these tests pin what surrounds it.
const queryRaw = vi.hoisted(() => vi.fn(async (_sql: string, _values: unknown[]) => [] as unknown[]))
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: { $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => queryRaw(strings.join('?'), values) },
}))

import { latestPositions, speedHistory } from '../positions'

beforeEach(() => { vi.clearAllMocks() })
const lastCall = () => ({ sql: queryRaw.mock.calls[0][0], values: queryRaw.mock.calls[0][1] })

describe('latestPositions', () => {
  it('always filters on the tenant, as a bound parameter, on both tables', async () => {
    await latestPositions('tenant-a', { since: new Date('2026-10-07T00:00:00Z') })
    const { sql, values } = lastCall()
    expect(sql).toContain('"tenantId" = ?')
    expect(sql).toContain('d."tenantId" = ?')
    expect(values.filter(v => v === 'tenant-a')).toHaveLength(2)
    expect(sql).not.toContain('tenant-a')
  })

  it('takes one row per driver straight from the index, never the whole window', async () => {
    await latestPositions('tenant-a', { since: new Date('2026-10-07T00:00:00Z') })
    const { sql, values } = lastCall()
    expect(sql).toMatch(/ORDER BY "recordedAt" DESC\s+LIMIT 1/)
    expect(values).toContain('2026-10-07T00:00:00.000Z')
  })

  it('all drivers by default, only the requested ones otherwise', async () => {
    await latestPositions('tenant-a', { since: new Date(0) })
    expect(lastCall().values).toEqual(expect.arrayContaining([true, []]))
    queryRaw.mockClear()
    await latestPositions('tenant-a', { since: new Date(0), driverIds: ['d1'] })
    expect(lastCall().values).toEqual(expect.arrayContaining([false, ['d1']]))
  })

  it('maps rows to the shape the live map reads; a stopped truck has ignition off', async () => {
    const at = new Date('2026-10-07T08:30:00Z')
    queryRaw.mockResolvedValueOnce([
      { driverId: 'd1', latitude: 45.9, longitude: 6.1, speedKmh: 42, recordedAt: at },
      { driverId: 'd2', latitude: 46, longitude: 6.2, speedKmh: null, recordedAt: at },
    ])
    expect(await latestPositions('tenant-a', { since: new Date(0) })).toEqual([
      { driverId: 'd1', lat: 45.9, lng: 6.1, speedKmh: 42, ignition: true, updatedAt: at.getTime() },
      { driverId: 'd2', lat: 46, lng: 6.2, speedKmh: 0, ignition: false, updatedAt: at.getTime() },
    ])
  })
})

describe('speedHistory', () => {
  it('groups in the database on the tenant clock and filters on the tenant', async () => {
    await speedHistory('tenant-a', '2026-07-01', 'Europe/Paris', ['d1'])
    const { sql, values } = lastCall()
    expect(sql).toContain('"tenantId" = ?')
    expect(sql).toContain('GROUP BY "driverId", minute')
    expect(values).toEqual(expect.arrayContaining(['tenant-a', 'Europe/Paris', '2026-07-01', false, ['d1']]))
  })

  it('narrows the scan to a window wide enough for any time zone', async () => {
    await speedHistory('tenant-a', '2026-07-01', 'Europe/Paris')
    const dates = lastCall().values.filter((v): v is string => typeof v === 'string' && v.endsWith('Z')).map(v => Date.parse(v))
    expect(Math.min(...dates)).toBeLessThanOrEqual(Date.parse('2026-06-30T12:00:00Z'))
    expect(Math.max(...dates)).toBeGreaterThanOrEqual(Date.parse('2026-07-02T12:00:00Z'))
  })

  it('returns the points per driver, in the order the database sorted them', async () => {
    queryRaw.mockResolvedValueOnce([
      { driverId: 'd1', minute: 540, speedKmh: 20 },
      { driverId: 'd1', minute: 541, speedKmh: 0 },
      { driverId: 'd2', minute: 540, speedKmh: 70 },
    ])
    expect(await speedHistory('tenant-a', '2026-01-15', 'Europe/Paris')).toEqual({
      d1: [{ minuteOfDay: 540, speedKmh: 20 }, { minuteOfDay: 541, speedKmh: 0 }],
      d2: [{ minuteOfDay: 540, speedKmh: 70 }],
    })
  })

  it('falls back to Paris time on an unknown zone instead of failing the map', async () => {
    await speedHistory('tenant-a', '2026-07-01', 'Not/AZone')
    expect(lastCall().values).toContain('Europe/Paris')
    expect(lastCall().values).not.toContain('Not/AZone')
  })

  it('returns nothing for a malformed date without querying', async () => {
    expect(await speedHistory('tenant-a', 'nope', 'Europe/Paris')).toEqual({})
    expect(await speedHistory('tenant-a', "2026-07-01'; DROP TABLE x; --", 'Europe/Paris')).toEqual({})
    expect(queryRaw).not.toHaveBeenCalled()
  })
})
