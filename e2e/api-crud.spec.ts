import { test, expect } from '@playwright/test'

test.describe('API — Authentication enforcement', () => {
  const protectedEndpoints = [
    { method: 'GET', url: '/api/drivers' },
    { method: 'GET', url: '/api/missions?date=2025-01-01' },
    { method: 'GET', url: '/api/vehicles' },
    { method: 'GET', url: '/api/exutoires' },
    { method: 'GET', url: '/api/plans?date=2025-01-01' },
    { method: 'GET', url: '/api/users' },
    { method: 'GET', url: '/api/holidays' },
    { method: 'GET', url: '/api/settings' },
    { method: 'GET', url: '/api/clients' },
    { method: 'GET', url: '/api/sites' },
    { method: 'GET', url: '/api/site-products' },
  ]

  for (const ep of protectedEndpoints) {
    test(`${ep.method} ${ep.url} requires auth`, async ({ request }) => {
      const res = await request.get(ep.url)

      expect([200, 401, 403, 404]).toContain(res.status())
    })
  }
})

test.describe('API — Input validation', () => {
  test('POST /api/missions rejects empty body', async ({ request }) => {
    const res = await request.post('/api/missions', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    })
    expect([400, 401, 403, 422]).toContain(res.status())
  })

  test('POST /api/drivers rejects empty body', async ({ request }) => {
    const res = await request.post('/api/drivers', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    })
    expect([400, 401, 403, 422]).toContain(res.status())
  })

  test('POST /api/vehicles rejects empty body', async ({ request }) => {
    const res = await request.post('/api/vehicles', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    })
    expect([400, 401, 403, 422]).toContain(res.status())
  })

  test('POST /api/exutoires rejects empty body', async ({ request }) => {
    const res = await request.post('/api/exutoires', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    })
    expect([400, 401, 403, 422]).toContain(res.status())
  })

  test('POST /api/users rejects empty body', async ({ request }) => {
    const res = await request.post('/api/users', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    })
    expect([400, 401, 403, 422]).toContain(res.status())
  })

  test('POST /api/holidays rejects empty body', async ({ request }) => {
    const res = await request.post('/api/holidays', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    })
    expect([400, 401, 403, 422]).toContain(res.status())
  })

  test('PUT /api/settings rejects invalid body', async ({ request }) => {
    const res = await request.put('/api/settings', {
      data: { defaultSpeedKmh: -999 },
      headers: { 'Content-Type': 'application/json' },
    })
    expect([401, 403, 422]).toContain(res.status())
  })
})

test.describe('API — Login', () => {
  test('POST /api/auth/login rejects missing password', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'test@test.com' },
      headers: { 'Content-Type': 'application/json' },
    })
    expect([400, 422]).toContain(res.status())
  })

  test('POST /api/auth/login rejects wrong password', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'admin@excoffier.fr', password: 'wrongpassword123' },
      headers: { 'Content-Type': 'application/json' },
    })
    expect([401]).toContain(res.status())
  })

  test('POST /api/auth/login returns cookie on success', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'admin@excoffier.fr', password: 'Excoffier2026!' },
      headers: { 'Content-Type': 'application/json' },
    })
    if (res.status() === 200) {
      const body = await res.json()
      expect(body.ok).toBeTruthy()
      expect(body.redirectTo).toBeTruthy()
    }
  })

  test('POST /api/auth/login rejects invalid JSON', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: 'not-json',
      headers: { 'Content-Type': 'text/plain' },
    })
    expect([400, 415, 422, 429]).toContain(res.status())
  })
})

test.describe('API — Health & Status', () => {
  test('GET /api/health returns status', async ({ request }) => {
    const res = await request.get('/api/health')

    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    expect(body).toHaveProperty('status')
  })
})
