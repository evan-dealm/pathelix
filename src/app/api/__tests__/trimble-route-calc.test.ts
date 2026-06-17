import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/data/context', () => ({
  getRequestContext: vi.fn(() => ({ tenantId: 't1', role: 'admin' })),
}))

const mockCalcTrimble = vi.hoisted(() => vi.fn())
const mockCalcRoute   = vi.hoisted(() => vi.fn())
vi.mock('@/services/trimble', () => ({
  calcTrimbleRoute: mockCalcTrimble,
  calcRoute:        mockCalcRoute,
}))

import { POST } from '@/app/api/trimble/route-calc/route'

const ORIGIN      = { lat: 48.85, lng: 2.35 }
const DESTINATION = { lat: 48.70, lng: 2.20 }

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/trimble/route-calc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => vi.clearAllMocks())

describe('POST /api/trimble/route-calc', () => {
  it('returns 400 on invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/trimble/route-calc', {
      method: 'POST',
      body: '{not:json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when origin is missing', async () => {
    const res = await POST(makeReq({ destination: DESTINATION }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/origin/i)
  })

  it('returns 400 when destination is missing', async () => {
    const res = await POST(makeReq({ origin: ORIGIN }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when lat out of range', async () => {
    const res = await POST(makeReq({ origin: { lat: 100, lng: 2.35 }, destination: DESTINATION }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when lng out of range', async () => {
    const res = await POST(makeReq({ origin: { lat: 48.85, lng: -200 }, destination: DESTINATION }))
    expect(res.status).toBe(400)
  })

  it('returns Trimble result with source=trimble when Trimble succeeds', async () => {
    mockCalcTrimble.mockResolvedValueOnce({ distanceKm: 22, durationMin: 28 })
    const res = await POST(makeReq({ origin: ORIGIN, destination: DESTINATION }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('trimble')
    expect(body.distanceKm).toBe(22)
    expect(body.durationMin).toBe(28)
    expect(mockCalcRoute).not.toHaveBeenCalled()
  })

  it('falls back to haversine when Trimble returns null', async () => {
    mockCalcTrimble.mockResolvedValueOnce(null)
    mockCalcRoute.mockResolvedValueOnce({ distanceKm: 20, durationMin: 25 })
    const res = await POST(makeReq({ origin: ORIGIN, destination: DESTINATION }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('haversine')
    expect(body.distanceKm).toBe(20)
  })

  it('passes waypoints to Trimble when provided', async () => {
    const waypoints = [{ lat: 48.80, lng: 2.30 }]
    mockCalcTrimble.mockResolvedValueOnce({ distanceKm: 30, durationMin: 35 })
    await POST(makeReq({ origin: ORIGIN, destination: DESTINATION, waypoints }))
    expect(mockCalcTrimble).toHaveBeenCalledWith({ origin: ORIGIN, destination: DESTINATION, waypoints })
  })

  it('returns 500 when service throws', async () => {
    mockCalcTrimble.mockRejectedValueOnce(new Error('Service unavailable'))
    const res = await POST(makeReq({ origin: ORIGIN, destination: DESTINATION }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/erreur serveur/i)
  })
})
