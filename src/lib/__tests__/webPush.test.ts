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

const testSub: PushSubRecord  = { endpoint: 'https://fcm.googleapis.com/fcm/send/ep1', p256dh: 'key1', auth: 'auth1' }
const testPayload: PushPayload = { title: 'Mission update', body: 'En route vers vous' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendPushNotification', () => {
  it('returns ok:true when sendNotification succeeds', async () => {
    mockWebpush.sendNotification.mockResolvedValue({})
    expect(await sendPushNotification(testSub, testPayload)).toEqual({ ok: true, expired: false })
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

  it('returns ok:false, expired:true on 410 (expired subscription)', async () => {
    mockWebpush.sendNotification.mockRejectedValue({ statusCode: 410 })
    expect(await sendPushNotification(testSub, testPayload)).toEqual({ ok: false, expired: true })
  })

  it('returns ok:false, expired:true on 404 (subscription gone)', async () => {
    mockWebpush.sendNotification.mockRejectedValue({ statusCode: 404 })
    expect(await sendPushNotification(testSub, testPayload)).toEqual({ ok: false, expired: true })
  })

  // Regression M2: a transient failure (any status/error other than 410/404 — 5xx, timeout,
  // throttling...) must NOT be reported as expired, or the caller deletes a valid subscription
  // just because the push service had a bad moment.
  it('returns ok:false, expired:false on other errors (does not throw, not treated as expired)', async () => {
    mockWebpush.sendNotification.mockRejectedValue(new Error('Network timeout'))
    await expect(sendPushNotification(testSub, testPayload)).resolves.toEqual({ ok: false, expired: false })
  })

  it('returns ok:false, expired:false on a 500 from the push service', async () => {
    mockWebpush.sendNotification.mockRejectedValue({ statusCode: 500 })
    await expect(sendPushNotification(testSub, testPayload)).resolves.toEqual({ ok: false, expired: false })
  })
})

describe('broadcastToTenant', () => {
  const subs: PushSubRecord[] = [
    { endpoint: 'https://fcm.googleapis.com/fcm/send/ep1', p256dh: 'k1', auth: 'a1' },
    { endpoint: 'https://fcm.googleapis.com/fcm/send/ep2', p256dh: 'k2', auth: 'a2' },
    { endpoint: 'https://fcm.googleapis.com/fcm/send/ep3', p256dh: 'k3', auth: 'a3' },
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

  // Regression: expired[] previously relied on Promise.allSettled rejections, but
  // sendPushNotification never rejects (it catches internally) — so expired[] was always empty
  // regardless of what actually failed. Now driven directly off each result's `expired` flag.
  it('populates expired[] only for genuinely expired (410/404) subscriptions', async () => {
    mockWebpush.sendNotification
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockRejectedValueOnce({ statusCode: 500 })
    const { sent, failed, expired } = await broadcastToTenant(subs, testPayload)
    expect(sent).toBe(1)
    expect(failed).toBe(2)
    expect(expired).toEqual([subs[1].endpoint])
  })

  it('returns empty arrays when subs list is empty', async () => {
    const { sent, failed, expired } = await broadcastToTenant([], testPayload)
    expect(sent).toBe(0)
    expect(failed).toBe(0)
    expect(expired).toEqual([])
  })
})

describe('sendPushNotification — endpoint allowlist', () => {
  it('never contacts an endpoint outside the browser push services (legacy rows) and flags it for deletion', async () => {
    const res = await sendPushNotification({ endpoint: 'http://10.0.0.5/internal', p256dh: 'k', auth: 'a' }, { title: 't', body: 'b' })
    expect(res).toEqual({ ok: false, expired: true })
  })
})
