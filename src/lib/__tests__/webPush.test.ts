vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY  = 'BTestPublicKeyForPushTests'
  process.env.VAPID_PRIVATE_KEY = 'TestPrivKeyForPushTests'
  process.env.VAPID_EMAIL       = 'test@pathelix.com'
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockWebpush = vi.hoisted(() => ({
  setVapidDetails:  vi.fn(),
  sendNotification: vi.fn(),
}))

vi.mock('web-push', () => ({ default: mockWebpush }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { sendPushNotification, broadcastToTenant } from '@/lib/webPush'
import type { PushSubRecord, PushPayload } from '@/lib/webPush'

const testSub: PushSubRecord  = { endpoint: 'https://push.example.com/ep1', p256dh: 'key1', auth: 'auth1' }
const testPayload: PushPayload = { title: 'Mission update', body: 'En route vers vous' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendPushNotification', () => {
  it('returns true when sendNotification succeeds', async () => {
    mockWebpush.sendNotification.mockResolvedValue({})
    expect(await sendPushNotification(testSub, testPayload)).toBe(true)
  })

  it('calls webpush.sendNotification with correct subscription keys', async () => {
    mockWebpush.sendNotification.mockResolvedValue({})
    await sendPushNotification(testSub, testPayload)
    expect(mockWebpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: testSub.endpoint, keys: { p256dh: testSub.p256dh, auth: testSub.auth } },
      JSON.stringify(testPayload),
      expect.objectContaining({ urgency: 'normal' }),
    )
  })

  it('returns false on 410 (expired subscription)', async () => {
    mockWebpush.sendNotification.mockRejectedValue({ statusCode: 410 })
    expect(await sendPushNotification(testSub, testPayload)).toBe(false)
  })

  it('returns false on 404 (subscription gone)', async () => {
    mockWebpush.sendNotification.mockRejectedValue({ statusCode: 404 })
    expect(await sendPushNotification(testSub, testPayload)).toBe(false)
  })

  it('returns false on other errors (does not throw)', async () => {
    mockWebpush.sendNotification.mockRejectedValue(new Error('Network timeout'))
    await expect(sendPushNotification(testSub, testPayload)).resolves.toBe(false)
  })
})

describe('broadcastToTenant', () => {
  const subs: PushSubRecord[] = [
    { endpoint: 'https://ep1.example.com', p256dh: 'k1', auth: 'a1' },
    { endpoint: 'https://ep2.example.com', p256dh: 'k2', auth: 'a2' },
    { endpoint: 'https://ep3.example.com', p256dh: 'k3', auth: 'a3' },
  ]

  it('counts sent correctly when all succeed', async () => {
    mockWebpush.sendNotification.mockResolvedValue({})
    const { sent, failed } = await broadcastToTenant(subs, testPayload)
    expect(sent).toBe(3)
    expect(failed).toBe(0)
  })

  it('counts failed correctly on partial failure', async () => {
    mockWebpush.sendNotification
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockResolvedValueOnce({})
    const { sent, failed } = await broadcastToTenant(subs, testPayload)
    expect(sent).toBe(2)
    expect(failed).toBe(1)
  })

  it('returns empty arrays when subs list is empty', async () => {
    const { sent, failed, expired } = await broadcastToTenant([], testPayload)
    expect(sent).toBe(0)
    expect(failed).toBe(0)
    expect(expired).toEqual([])
  })
})
