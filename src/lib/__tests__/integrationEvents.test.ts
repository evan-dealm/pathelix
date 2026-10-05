import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  integration: { findMany: vi.fn() },
}))

vi.mock('@/lib/tenantDb', () => ({ getTenantDb: () => mockPrisma }))
// DNS-based SSRF guard is unit-tested in securityHardening.test.ts — here it only forwards.
vi.mock('@/lib/outboundUrl', () => ({
  safeFetch: (url: string, init: RequestInit) => fetch(url, init),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { emitEvent, invalidateIntegrationCache } from '@/lib/integrationEvents'

const OLD_DATABASE_URL = process.env.DATABASE_URL

beforeEach(() => {
  vi.clearAllMocks()
  process.env.DATABASE_URL = 'postgresql://test'
  invalidateIntegrationCache('t-1')
  mockFetch.mockResolvedValue({ ok: true, json: vi.fn() })
})

afterEach(() => {
  if (OLD_DATABASE_URL) {
    process.env.DATABASE_URL = OLD_DATABASE_URL
  } else {
    delete process.env.DATABASE_URL
  }
})

describe('emitEvent', () => {
  it('returns early when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL
    await emitEvent('t-1', 'mission.done', {})
    expect(mockPrisma.integration.findMany).not.toHaveBeenCalled()
  })

  it('does not call fetch when no integrations configured', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([])
    await emitEvent('t-1', 'tour.published', { driverCount: 3 })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends Slack notification when slack integration is configured', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/test' } },
    ])

    await emitEvent('t-1', 'mission.done', {
      driverName: 'Jean', missionType: 'POSER', address: '10 rue test', durationMin: 30,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('sends Teams notification when teams integration is configured', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { type: 'teams', config: { webhookUrl: 'https://outlook.office.com/webhook/test' } },
    ])

    await emitEvent('t-1', 'tour.optimized', {
      assignedMissions: 10, driverCount: 2, score: 85, timeTakenMs: 3000,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://outlook.office.com/webhook/test',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('sends custom webhook with HMAC signature when secret configured', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { type: 'custom_webhook', config: { url: 'https://my-api.com/hook', secret: 'mysecret123', events: '' } },
    ])

    await emitEvent('t-1', 'anomaly.detected', { reason: 'test', driverName: 'X', missionId: 'm-1' })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://my-api.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Pathelix-Signature': expect.any(String) }),
      }),
    )
  })

  it('skips custom webhook when event not in configured events list', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { type: 'custom_webhook', config: { url: 'https://my-api.com/hook', events: 'mission.done,tour.published' } },
    ])

    await emitEvent('t-1', 'anomaly.detected', {})
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips twilio SMS for non-en_route events', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { type: 'twilio_sms', config: { accountSid: 'sid', authToken: 'tok', fromNumber: '+33600' } },
    ])

    await emitEvent('t-1', 'mission.done', {})
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('dispatches twilio SMS for driver.en_route event', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { type: 'twilio_sms', config: { accountSid: 'ACtest', authToken: 'token123', fromNumber: '+33600000000' } },
    ])

    await emitEvent('t-1', 'driver.en_route', {
      clientPhone: '+33612345678', driverName: 'Paul', etaMinutes: 15,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('handles DB error gracefully (non-fatal)', async () => {
    mockPrisma.integration.findMany.mockRejectedValue(new Error('DB fail'))
    await expect(emitEvent('t-1', 'mission.done', {})).resolves.not.toThrow()
  })

  it('handles Slack fetch failure gracefully', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/fail' } },
    ])
    mockFetch.mockRejectedValue(new Error('Network error'))

    await expect(emitEvent('t-1', 'tour.published', {})).resolves.not.toThrow()
  })

  it('decrypts stored (AES-GCM) configs before using them', async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'a'.repeat(64)
    const { encryptConfig } = await import('@/lib/configCrypto')
    mockPrisma.integration.findMany.mockResolvedValue([
      { type: 'slack', config: encryptConfig({ webhookUrl: 'https://hooks.slack.com/encrypted' }) },
    ])
    await emitEvent('t-1', 'mission.done', { driverName: 'Jean' })
    expect(mockFetch.mock.calls[0][0]).toBe('https://hooks.slack.com/encrypted')
    delete process.env.INTEGRATION_ENCRYPTION_KEY
  })

  it('does not post every GPS ping to Slack/Teams', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([
      { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/test' } },
      { type: 'teams', config: { webhookUrl: 'https://outlook.office.com/webhook/x' } },
    ])
    await emitEvent('t-1', 'driver.position', { lat: 45, lng: 4 })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('caches the integration list per tenant between events', async () => {
    mockPrisma.integration.findMany.mockResolvedValue([])
    await emitEvent('t-1', 'mission.done', {})
    await emitEvent('t-1', 'mission.done', {})
    expect(mockPrisma.integration.findMany).toHaveBeenCalledTimes(1)
  })
})
