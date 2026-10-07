import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.USE_MOCK_DATA = 'false'
})

const mockCreateMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' })),
}))

vi.mock('@/lib/rateLimit', () => ({
  createTenantRateLimiter: () => ({
    check: vi.fn(() => Promise.resolve(true)),
    headers: vi.fn(() => ({})),
  }),
  createRateLimiter: () => ({ check: vi.fn(() => true), headers: vi.fn(() => ({})) }),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@/lib/redisCache', () => ({
  redisCache: { invalidateAll: vi.fn(() => Promise.resolve()) },
}))

vi.mock('@/lib/tenantDb', () => ({
  getTenantDb: () => ({
    mission: { createMany: mockCreateMany },
    driver: { createMany: mockCreateMany },
    client: { createMany: mockCreateMany },
    site: { createMany: mockCreateMany },
    exutoire: { createMany: mockCreateMany },
  }),
}))

import { POST } from '@/app/api/import/route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const MISSION = { type: 'POSER', date: '2026-10-07', address: '12 rue de la Paix, Paris' }

/** Rows handed to createMany by the last import (empty when nothing was written). */
function writtenRows(): Array<Record<string, unknown>> {
  const call = mockCreateMany.mock.calls[0]
  return call ? (call[0].data as Array<Record<string, unknown>>) : []
}

beforeEach(() => {
  mockCreateMany.mockReset()
  mockCreateMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({
    count: data.length,
  }))
})

describe('POST /api/import — missions: a row is imported only if the planning can show it', () => {
  it('converts the French spreadsheet date DD/MM/YYYY to the stored YYYY-MM-DD', async () => {
    // Stored as typed, « 07/10/2026 » matched no day: the mission existed but appeared nowhere.
    const res = await POST(
      makeRequest({ type: 'missions', data: [{ ...MISSION, date: '07/10/2026' }] }),
    )
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(writtenRows()[0].date).toBe('2026-10-07')
  })

  it('refuses a date that is not a real day, and names the line', async () => {
    const res = await POST(
      makeRequest({
        type: 'missions',
        data: [
          MISSION,
          { ...MISSION, date: '2026-02-30' },
          { ...MISSION, date: 'demain' },
          { ...MISSION, date: '31/04/2026' },
        ],
      }),
    )
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(writtenRows()).toHaveLength(1)
    expect(body.totalErrors).toBe(3)
    expect(body.errors[0]).toMatch(/^Ligne 2: date invalide/)
    expect(body.errors[1]).toMatch(/^Ligne 3: date invalide/)
    expect(body.errors[2]).toMatch(/^Ligne 4: date invalide/)
  })

  it('refuses a mission without address', async () => {
    const res = await POST(
      makeRequest({
        type: 'missions',
        data: [
          { ...MISSION, address: '   ' },
          { type: 'POSER', date: '2026-10-07' },
        ],
      }),
    )
    const body = await res.json()
    expect(body.imported).toBe(0)
    expect(mockCreateMany).not.toHaveBeenCalled()
    expect(body.errors).toEqual(['Ligne 1: adresse manquante', 'Ligne 2: adresse manquante'])
  })

  it('refuses a priority outside 1–3 and a negative or absurd duration', async () => {
    const res = await POST(
      makeRequest({
        type: 'missions',
        data: [
          { ...MISSION, priority: 9 },
          { ...MISSION, estimatedDurationMin: -20 },
          { ...MISSION, estimatedDurationMin: 100000 },
          { ...MISSION, maneuverTimeMin: -5 },
          { ...MISSION, priority: '2', estimatedDurationMin: '45' },
        ],
      }),
    )
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(body.totalErrors).toBe(4)
    expect(body.errors[0]).toMatch(/^Ligne 1: priorité invalide/)
    expect(body.errors[1]).toMatch(/^Ligne 2: durée invalide/)
    expect(body.errors[2]).toMatch(/^Ligne 3: durée invalide/)
    expect(body.errors[3]).toMatch(/^Ligne 4: temps de manœuvre invalide/)
    expect(writtenRows()[0]).toMatchObject({ priority: 2, estimatedDurationMin: 45 })
  })

  it('does not count rejected rows as needing geocoding', async () => {
    const res = await POST(
      makeRequest({ type: 'missions', data: [{ ...MISSION, date: 'x' }, MISSION] }),
    )
    const body = await res.json()
    expect(body.needsGeocode).toBe(1)
  })

  it('still defaults a missing date and missing durations', async () => {
    const res = await POST(
      makeRequest({
        type: 'missions',
        data: [{ type: 'RETIRER', address: '3 quai Perrache, Lyon' }],
      }),
    )
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(writtenRows()[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(writtenRows()[0]).toMatchObject({ estimatedDurationMin: 30, maneuverTimeMin: 15 })
  })
})

describe('POST /api/import — other lists: nameless rows are refused, the rest is imported', () => {
  it('drivers need a first and a last name', async () => {
    const res = await POST(
      makeRequest({
        type: 'drivers',
        data: [
          { prenom: 'Alice', nom: 'Martin' },
          { prenom: 'Bob' },
          { firstName: ' ', lastName: 'Durand' },
        ],
      }),
    )
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(writtenRows()).toHaveLength(1)
    expect(writtenRows()[0]).toMatchObject({ firstName: 'Alice', lastName: 'Martin' })
    expect(body.errors).toEqual(['Ligne 2: prénom et nom requis', 'Ligne 3: prénom et nom requis'])
  })

  it.each(['clients', 'sites', 'exutoires'])('%s need a name', async type => {
    const res = await POST(
      makeRequest({
        type,
        data: [{ nom: 'Mairie de Voiron', adresse: '1 place' }, { adresse: '2 rue' }],
      }),
    )
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(writtenRows()).toHaveLength(1)
    expect(body.errors).toEqual(['Ligne 2: nom manquant'])
  })

  it('writes nothing when every row is refused', async () => {
    const res = await POST(makeRequest({ type: 'clients', data: [{ email: 'a@b.fr' }] }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.imported).toBe(0)
    expect(mockCreateMany).not.toHaveBeenCalled()
  })
})
