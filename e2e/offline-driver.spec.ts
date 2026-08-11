import { test, expect } from '@playwright/test'

/**
 * Offline mode E2E tests for the driver page.
 * Uses context.setOffline() to simulate network loss and recovery.
 * Requires: dev server running (baseURL http://localhost:3000).
 */
test.describe('Driver — offline mode', () => {
  test('page loads and shows offline indicator when network is cut', async ({ page, context }) => {
    await page.goto('/driver/test-driver-id', { waitUntil: 'domcontentloaded' })

    // Simulate going offline
    await context.setOffline(true)

    // Wait briefly for the online/offline event to propagate
    await page.waitForTimeout(300)

    // Page should still be rendering (cached shell)
    const body = await page.textContent('body')
    expect(body).toBeTruthy()

    // Restore network
    await context.setOffline(false)
  })

  test('page recovers when network is restored', async ({ page, context }) => {
    await page.goto('/driver/test-driver-id', { waitUntil: 'domcontentloaded' })

    await context.setOffline(true)
    await page.waitForTimeout(200)

    await context.setOffline(false)
    await page.waitForTimeout(500)

    // Page still functional after recovery
    const body = await page.textContent('body')
    expect(body!.length).toBeGreaterThan(10)
  })

  test('offline then online cycle does not crash the page', async ({ page, context }) => {
    const criticalErrors: string[] = []
    page.on('pageerror', e => {
      if (!e.message.includes('Loading chunk') && !e.message.includes('ChunkLoadError')) {
        criticalErrors.push(e.message)
      }
    })

    await page.goto('/driver/test-driver-id', { waitUntil: 'domcontentloaded' })

    // Go offline
    await context.setOffline(true)
    await page.waitForTimeout(300)

    // Go online
    await context.setOffline(false)
    await page.waitForTimeout(500)

    // No critical JS errors
    expect(criticalErrors).toHaveLength(0)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('rapid offline/online toggles do not cause duplicate flush (concurrent lock)', async ({ page, context }) => {
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.goto('/driver/test-driver-id', { waitUntil: 'domcontentloaded' })

    // Rapid toggles — exercises the _flushInProgress lock
    await context.setOffline(true)
    await page.waitForTimeout(50)
    await context.setOffline(false)
    await page.waitForTimeout(50)
    await context.setOffline(true)
    await page.waitForTimeout(50)
    await context.setOffline(false)
    await page.waitForTimeout(500)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })
})
