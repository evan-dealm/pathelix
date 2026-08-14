import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/httpClient', () => ({
  fetchProtected: vi.fn(),
}))
vi.mock('@/lib/circuitBreaker', () => ({
  getCircuitBreaker: vi.fn(() => ({ getState: vi.fn(() => 'CLOSED') })),
}))
vi.mock('@/lib/metrics', () => ({
  metrics: { increment: vi.fn(), histogram: vi.fn(), gauge: vi.fn() },
  METRIC:  { CB_FAILURE: 'cb.failure' },
}))

import { verifyNessySignature, nessyPayloadToMission } from '@/services/nessy'

async function computeSignature(body: string, secret: string): Promise<string> {
  const enc      = new TextEncoder()
  const key      = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  )
  const sig      = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const hex      = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `sha256=${hex}`
}

const SECRET = 'test-hmac-secret-for-nessy'

describe('verifyNessySignature', () => {
  it('returns true for a correct HMAC signature', async () => {
    const body = JSON.stringify({ missions: [] })
    const sig  = await computeSignature(body, SECRET)
    expect(await verifyNessySignature(body, sig, SECRET)).toBe(true)
  })

  it('returns false for a tampered body', async () => {
    const body      = JSON.stringify({ missions: [] })
    const sig       = await computeSignature(body, SECRET)
    const tampered  = JSON.stringify({ missions: [{ type: 'POSER' }] })
    expect(await verifyNessySignature(tampered, sig, SECRET)).toBe(false)
  })

  it('returns false for wrong secret', async () => {
    const body = JSON.stringify({ missions: [] })
    const sig  = await computeSignature(body, 'wrong-secret')
    expect(await verifyNessySignature(body, sig, SECRET)).toBe(false)
  })

  it('returns false when signature header missing sha256= prefix', async () => {
    const body = JSON.stringify({ missions: [] })
    expect(await verifyNessySignature(body, 'deadbeef', SECRET)).toBe(false)
  })

  it('returns false for empty signature header', async () => {
    expect(await verifyNessySignature('{}', '', SECRET)).toBe(false)
  })

  it('handles empty body correctly (valid signature for empty string)', async () => {
    const body = ''
    const sig  = await computeSignature(body, SECRET)
    expect(await verifyNessySignature(body, sig, SECRET)).toBe(true)
  })

  it('returns false when crypto.subtle.importKey throws (catch branch)', async () => {
    const importKeySpy = vi.spyOn(globalThis.crypto.subtle, 'importKey')
      .mockRejectedValueOnce(new Error('SubtleCrypto unavailable'))
    try {
      const result = await verifyNessySignature('body', 'sha256=deadbeef', SECRET)
      expect(result).toBe(false)
    } finally {
      importKeySpy.mockRestore()
    }
  })
})

describe('nessyPayloadToMission', () => {
  const basePayload = {
    type:                 'POSER',
    date:                 '2026-05-10',
    address:              '10 rue de Lyon, Lyon',
    latitude:             45.75,
    longitude:            4.83,
    estimatedDurationMin: 30,
  }

  it('maps a valid POSER payload correctly', () => {
    const mission = nessyPayloadToMission(basePayload)
    expect(mission.type).toBe('POSER')
    expect(mission.address).toBe('10 rue de Lyon, Lyon')
    expect(mission.latitude).toBe(45.75)
    expect(mission.longitude).toBe(4.83)
    expect(mission.estimatedDurationMin).toBe(30)
    expect(mission.maneuverTimeMin).toBe(0)
  })

  it('falls back to POSER for unknown mission type', () => {
    const mission = nessyPayloadToMission({ ...basePayload, type: 'UNKNOWN_TYPE' })
    expect(mission.type).toBe('POSER')
  })

  it('accepts all 10 valid mission types', () => {
    const types = ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR']
    for (const type of types) {
      const mission = nessyPayloadToMission({ ...basePayload, type })
      expect(mission.type).toBe(type)
    }
  })

  it('throws for invalid latitude (out of range)', () => {
    expect(() => nessyPayloadToMission({ ...basePayload, latitude: 200, longitude: 4.83 }))
      .toThrow('Coordonnées GPS invalides')
  })

  it('throws for invalid longitude (out of range)', () => {
    expect(() => nessyPayloadToMission({ ...basePayload, latitude: 45.75, longitude: 200 }))
      .toThrow('Coordonnées GPS invalides')
  })

  it('throws for NaN coordinates', () => {
    expect(() => nessyPayloadToMission({ ...basePayload, latitude: NaN, longitude: 4.83 }))
      .toThrow('Coordonnées GPS invalides')
  })

  it('includes timeWindow when both open and close are set', () => {
    const mission = nessyPayloadToMission({
      ...basePayload,
      timeWindowOpenMin:  480,
      timeWindowCloseMin: 1020,
    })
    expect(mission.timeWindow).toEqual({ openMin: 480, closeMin: 1020 })
  })

  it('timeWindow is undefined when openMin is null', () => {
    const mission = nessyPayloadToMission({
      ...basePayload,
      timeWindowOpenMin:  null as any,
      timeWindowCloseMin: 1020,
    })
    expect(mission.timeWindow).toBeUndefined()
  })

  it('preserves priority 1, 2, 3 and rejects 0 or 4', () => {
    expect(nessyPayloadToMission({ ...basePayload, priority: 1 }).priority).toBe(1)
    expect(nessyPayloadToMission({ ...basePayload, priority: 3 }).priority).toBe(3)
    expect(nessyPayloadToMission({ ...basePayload, priority: 0 }).priority).toBeUndefined()
    expect(nessyPayloadToMission({ ...basePayload, priority: 4 }).priority).toBeUndefined()
  })

  it('uses provided maneuverTimeMin', () => {
    const mission = nessyPayloadToMission({ ...basePayload, maneuverTimeMin: 15 })
    expect(mission.maneuverTimeMin).toBe(15)
  })
})

describe('module-level deprecated env var warning', () => {
  afterEach(async () => {
    vi.doUnmock('@/lib/logger')
    vi.resetModules()
  })

  // NESSY_WEBHOOK_SECRET no longer gates webhook auth (that's per-tenant
  // via Integration now) — it just warns if still set, since it's a no-op that can be removed.
  it('warns when NESSY_WEBHOOK_SECRET is still set (deprecated, no longer used for auth)', async () => {
    const capturedWarnings: string[] = []
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        error: vi.fn(),
        info:  vi.fn(),
        warn:  (...args: unknown[]) => capturedWarnings.push(String(args[0])),
        debug: vi.fn(),
      }),
    }))

    const env = process.env as Record<string, string | undefined>
    const origKey = env.NESSY_WEBHOOK_SECRET
    env.NESSY_WEBHOOK_SECRET = 'some-secret-still-set'

    vi.resetModules()
    await import('@/services/nessy')

    if (origKey !== undefined) env.NESSY_WEBHOOK_SECRET = origKey
    else delete env.NESSY_WEBHOOK_SECRET

    expect(capturedWarnings.some(e => e.includes('NESSY_WEBHOOK_SECRET'))).toBe(true)
  })

  it('does not warn when NESSY_WEBHOOK_SECRET is unset', async () => {
    const capturedWarnings: string[] = []
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        error: vi.fn(),
        info:  vi.fn(),
        warn:  (...args: unknown[]) => capturedWarnings.push(String(args[0])),
        debug: vi.fn(),
      }),
    }))

    const env = process.env as Record<string, string | undefined>
    const origKey = env.NESSY_WEBHOOK_SECRET
    delete env.NESSY_WEBHOOK_SECRET

    vi.resetModules()
    await import('@/services/nessy')

    if (origKey !== undefined) env.NESSY_WEBHOOK_SECRET = origKey

    expect(capturedWarnings.some(e => e.includes('NESSY_WEBHOOK_SECRET'))).toBe(false)
  })
})
