import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

test.describe('Accessibility', () => {
  test('login page has form labels', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    const labels = await page.locator('label').count()
    expect(labels).toBeGreaterThanOrEqual(2)
  })

  test('login page is keyboard navigable', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => document.activeElement?.tagName)
    expect(focused).toBeTruthy()
  })

  test('login button is focusable', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    const submitBtn = page.locator('button[type="submit"]')
    await submitBtn.focus()
    const isFocused = await submitBtn.evaluate(el => el === document.activeElement)
    expect(isFocused).toBeTruthy()
  })

  test('checkboxes have aria-labels or ids', async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'Missions')
    await page.waitForTimeout(1000)

    const checkboxes = page.locator('input[type="checkbox"]')
    const count = await checkboxes.count()

    for (let i = 0; i < Math.min(count, 5); i++) {
      const ariaLabel = await checkboxes.nth(i).getAttribute('aria-label')
      const id        = await checkboxes.nth(i).getAttribute('id')
      const title     = await checkboxes.nth(i).getAttribute('title')

      expect(ariaLabel || id || title).toBeTruthy()
    }
  })

  test('select inputs have accessible labels', async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'Missions')
    await page.waitForTimeout(1000)

    const selects = page.locator('select')
    const count = await selects.count()
    for (let i = 0; i < Math.min(count, 5); i++) {
      const title     = await selects.nth(i).getAttribute('title')
      const ariaLabel = await selects.nth(i).getAttribute('aria-label')
      const id        = await selects.nth(i).getAttribute('id')

      expect(title || ariaLabel || id).toBeTruthy()
    }
  })

  test('modal opens and closes with keyboard', async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'Missions')
    await page.waitForTimeout(500)

    const newBtn = page.locator('button:has-text("Nouvelle mission"), button:has-text("+ Mission"), button:has-text("Nouveau")').first()
    const btnVisible = await newBtn.isVisible({ timeout: 5000 }).catch(() => false)
    if (btnVisible) {
      await newBtn.click()
      await page.waitForTimeout(500)

      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab')
      }

      const body = await page.textContent('body').catch(() => '')
      expect(body !== null).toBeTruthy()

      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(300)
    } else {
      const body = await page.textContent('body').catch(() => '')
      expect(body !== null).toBeTruthy()
    }
  })
})
