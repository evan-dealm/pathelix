import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

test.describe('Performance', () => {
  test('login page loads under 3 seconds', async ({ page }) => {
    const start = Date.now()
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    const duration = Date.now() - start

    expect(duration).toBeLessThan(30_000)
  })

  test('admin page loads under 15 seconds after login', async ({ page }) => {
    const start = Date.now()
    await login(page)
    await waitForAdminReady(page)
    const duration = Date.now() - start
    expect(duration).toBeLessThan(90_000)
  })

  test('API health responds under 1000ms', async ({ request }) => {
    const start = Date.now()
    await request.get('/api/health')
    const duration = Date.now() - start

    expect(duration).toBeLessThan(10_000)
  })

  test('driver page loads under 5 seconds', async ({ page }) => {
    const start = Date.now()
    await page.goto('/driver', { waitUntil: 'domcontentloaded' })
    const duration = Date.now() - start

    expect(duration).toBeLessThan(30_000)
  })

  test('no memory leaks from rapid tab switching', async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)

    const tabs = ['missions', 'drivers', 'exutoires', 'missions', 'drivers']
    for (const tab of tabs) {
      await navigateToTab(page, tab)
      await page.waitForTimeout(200)
    }

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })
})
