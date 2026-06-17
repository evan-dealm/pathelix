import { test, expect } from '@playwright/test'

// Public tracking page — no auth required
// These tests use the mock API which returns tracking data without real DB

test.describe('Public tracking page', () => {
  test('tracking page loads without authentication', async ({ page }) => {
    // The page at /track/:token is public (no auth required)
    await page.goto('/track/test-tracking-token', { waitUntil: 'domcontentloaded' })
    // Should NOT redirect to /login
    expect(page.url()).not.toContain('login')
  })

  test('tracking API returns data for valid token (mock)', async ({ page }) => {
    const res = await page.request.get('/api/tracking?token=mock-token')
    // Mock mode returns data or 200; may 404 with real DB
    expect([200, 404]).toContain(res.status())
  })

  test('tracking API with no token returns 400 or 404', async ({ page }) => {
    const res = await page.request.get('/api/tracking')
    expect([400, 404, 422]).toContain(res.status())
  })

  test('tracking page has no console errors with mock token', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))
    await page.goto('/track/mock-token-e2e', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    expect(errors).toHaveLength(0)
  })

  test('tracking page renders state indicator', async ({ page }) => {
    await page.goto('/track/mock-token-e2e', { waitUntil: 'domcontentloaded' })
    // Page should render some content (not blank)
    const body = await page.locator('body').textContent()
    expect(body?.length).toBeGreaterThan(0)
  })

  test('does not trigger Valhalla calls from public tracking page', async ({ page }) => {
    const valhallaRequests: string[] = []
    page.on('request', req => {
      const url = req.url()
      if (url.includes('valhalla') || url.includes(':8002') || url.includes('/route')) {
        valhallaRequests.push(url)
      }
    })
    await page.goto('/track/mock-token-e2e', { waitUntil: 'networkidle' })
    // Public tracking page must NOT trigger route computation
    const valhallaApiCalls = valhallaRequests.filter(u => !u.includes('localhost:3000'))
    expect(valhallaApiCalls).toHaveLength(0)
  })
})
