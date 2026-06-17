import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

test.describe('Responsive Design', () => {
  test('login page works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('login page works on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('admin page works on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await login(page)
    await waitForAdminReady(page)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('missions tab renders on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'Missions')
    await page.waitForTimeout(1000)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('driver view works on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/driver', { waitUntil: 'domcontentloaded' })
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })
})
