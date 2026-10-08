import { describe, it, expect, vi, beforeEach } from 'vitest'

// The SQL itself (latest row per driver, local-day grouping, tenant isolation) is exercised on a
// real PostgreSQL by .manualtest/positions-flow.ts; these tests pin what surrounds it.
const queryRaw = vi.hoisted(() =>
  vi.fn(async (_sql: string, _values: unknown[]) => [] as unknown[]),
)
vi.mock('@/lib/tenantDb', () => ({
  unscopedPrisma: {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) =>
      queryRaw(strings.join('?'), values),
  },
}))

import { latestPositions, speedHistory, _clearPositionsCache } from '../positions'

beforeEach(() => {
  queryRaw.mockReset()
  queryRaw.mockImplementation(async () => [])
  _clearPositionsCache()
})
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
      {
        driverId: 'd1',
        lat: 45.9,
        lng: 6.1,
        speedKmh: 42,
        ignition: true,
        updatedAt: at.getTime(),
      },
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
    expect(values).toEqual(
      expect.arrayContaining(['tenant-a', 'Europe/Paris', '2026-07-01', false, ['d1']]),
    )
  })

  // The index scan used to cover a fixed 52-hour window "wide enough for any time zone": twice
  // the rows of the day (measured: 943 000 instead of 540 000 for 500 drivers). PostgreSQL now
  // converts the two ends of the local day itself — exact in any zone, daylight saving included
  // (checked on a real database: .manualtest/positions-flow.ts).
  it('scans exactly the local day: its two ends are converted to UTC by the database', async () => {
    await speedHistory('tenant-a', '2026-07-01', 'Europe/Paris')
    const { sql, values } = lastCall()
    expect(sql).toMatch(
      /"recordedAt" >= \(\(\?::date\)::timestamp AT TIME ZONE \?\) AT TIME ZONE 'UTC'/,
    )
    expect(sql).toMatch(
      /"recordedAt" <\s+\(\(\?::date \+ 1\)::timestamp AT TIME ZONE \?\) AT TIME ZONE 'UTC'/,
    )
    // No precomputed UTC instant is sent any more.
    expect(values.some(v => typeof v === 'string' && v.endsWith('Z'))).toBe(false)
  })

  it('returns the points per driver, in the order the database sorted them', async () => {
    queryRaw.mockResolvedValueOnce([
      { driverId: 'd1', minute: 540, speedKmh: 20 },
      { driverId: 'd1', minute: 541, speedKmh: 0 },
      { driverId: 'd2', minute: 540, speedKmh: 70 },
    ])
    expect(await speedHistory('tenant-a', '2026-01-15', 'Europe/Paris')).toEqual({
      d1: [
        { minuteOfDay: 540, speedKmh: 20 },
        { minuteOfDay: 541, speedKmh: 0 },
      ],
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
    expect(await speedHistory('tenant-a', "2026-07-01'; DROP TABLE x; --", 'Europe/Paris')).toEqual(
      {},
    )
    expect(queryRaw).not.toHaveBeenCalled()
  })
})

describe('shared reads (many dispatch screens, one query)', () => {
  it('screens of one organisation polling together share one query; another organisation gets its own', async () => {
    queryRaw.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 5))
      return []
    })
    const since = new Date('2026-10-07T00:00:00Z')
    await Promise.all([
      ...Array.from({ length: 30 }, () => latestPositions('tenant-a', { since })),
      ...Array.from({ length: 30 }, () => speedHistory('tenant-a', '2026-07-01', 'Europe/Paris')),
    ])
    expect(queryRaw).toHaveBeenCalledTimes(2)
    await latestPositions('tenant-b', { since })
    expect(queryRaw).toHaveBeenCalledTimes(3)
    expect(queryRaw.mock.calls[2][1]).toContain('tenant-b')
  })

  it('a filtered read never answers an unfiltered one (and the reverse)', async () => {
    const since = new Date('2026-10-07T00:00:00Z')
    await latestPositions('tenant-a', { since, driverIds: ['d1'] })
    await latestPositions('tenant-a', { since })
    await latestPositions('tenant-a', { since, driverIds: ['d2'] })
    expect(queryRaw).toHaveBeenCalledTimes(3)
  })

  it('reads again once the answer is a few seconds old', async () => {
    vi.useFakeTimers()
    try {
      const since = new Date('2026-10-07T00:00:00Z')
      await latestPositions('tenant-a', { since })
      vi.advanceTimersByTime(1_000)
      await latestPositions('tenant-a', { since })
      expect(queryRaw).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(3_000)
      await latestPositions('tenant-a', { since })
      expect(queryRaw).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not keep a failed read', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection lost'))
    const since = new Date('2026-10-07T00:00:00Z')
    await expect(latestPositions('tenant-a', { since })).rejects.toThrow('connection lost')
    await expect(latestPositions('tenant-a', { since })).resolves.toEqual([])
    expect(queryRaw).toHaveBeenCalledTimes(2)
  })
})
