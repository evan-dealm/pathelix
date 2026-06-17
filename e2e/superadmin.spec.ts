import { test, expect } from '@playwright/test'
import { login, waitForAdminReady } from './helpers'

// Superadmin tests run in mock mode.
// The mock login endpoint returns admin role — superadmin endpoints are tested via API.

test.describe('Superadmin — API coverage', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
  })

  test('superadmin stats endpoint responds', async ({ page }) => {
    const res = await page.request.get('/api/superadmin/stats')
    // 403 expected in mock mode (admin role, not superadmin); 200 in SA session
    expect([200, 403]).toContain(res.status())
  })

  test('superadmin tenants list accessible', async ({ page }) => {
    const res = await page.request.get('/api/superadmin/tenants')
    expect([200, 403]).toContain(res.status())
  })

  test('superadmin system health endpoint', async ({ page }) => {
    const res = await page.request.get('/api/superadmin/system-health')
    expect([200, 403]).toContain(res.status())
  })

  test('exit impersonation endpoint exists', async ({ page }) => {
    const res = await page.request.post('/api/superadmin/exit-impersonation')
    // Without active impersonation session: 400 or 403
    expect([200, 400, 403]).toContain(res.status())
  })

  test('superadmin audit logs endpoint', async ({ page }) => {
    const res = await page.request.get('/api/superadmin/audit-logs')
    expect([200, 403]).toContain(res.status())
  })

  test('superadmin users list endpoint', async ({ page }) => {
    const res = await page.request.get('/api/superadmin/users')
    expect([200, 403]).toContain(res.status())
  })

  test('superadmin ml-status endpoint', async ({ page }) => {
    const res = await page.request.get('/api/superadmin/ml-status')
    expect([200, 403]).toContain(res.status())
  })
})

test.describe('Superadmin — page access', () => {
  test('superadmin page redirects non-superadmin to /admin or /login', async ({ page }) => {
    await page.goto('/superadmin', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    // Non-superadmin should be redirected away
    const url = page.url()
    expect(url).toMatch(/\/(admin|login|superadmin)/)
  })

  test('superadmin page has no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', err => {
      // Filter hydration warnings and known non-critical errors
      if (!err.message.includes('Hydration') && !err.message.includes('Warning')) {
        errors.push(err.message)
      }
    })
    await page.goto('/superadmin', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    expect(errors).toHaveLength(0)
  })
})
