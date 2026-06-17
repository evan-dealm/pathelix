import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

test.describe('Tours Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'tours')
    await page.waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    ).catch(() => {})
    await page.waitForTimeout(300)
  })

  test('tours tab loads', async ({ page }) => {
    const panel = page.locator('[role="tabpanel"]').first()
    await expect(panel).toBeVisible({ timeout: 10_000 })
    const content = await panel.textContent()
    expect(content!.trim().length).toBeGreaterThan(5)
  })

  test('optimize button exists', async ({ page }) => {
    const optimizeBtn = page.locator('button:has-text("Optimiser")').first()
    await expect(optimizeBtn).toBeVisible({ timeout: 10_000 })
    await expect(optimizeBtn).toBeEnabled()
  })

  test('optimization weight panel can be opened', async ({ page }) => {
    const gearBtn = page.locator('button[title="Parametres d\'optimisation"]').first()
    await expect(gearBtn).toBeVisible({ timeout: 10_000 })
    await gearBtn.click()
    await page.waitForTimeout(400)
    const panel = page.locator('text=/Priorites d\'optimisation|Optimiser la distance|Respecter les horaires/i').first()
    await expect(panel).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
  })

  test('date navigation works', async ({ page }) => {
    const nextBtn = page.locator('[role="tabpanel"] button[title*="suivant" i], [role="tabpanel"] button[aria-label*="suivant" i]').first()
    await expect(nextBtn).toBeVisible({ timeout: 10_000 })
    await nextBtn.click()
    await page.waitForTimeout(300)
    const prevBtn = page.locator('[role="tabpanel"] button[title*="pr" i], [role="tabpanel"] button[aria-label*="précédent" i]').first()
    await expect(prevBtn).toBeVisible({ timeout: 5_000 })
    await prevBtn.click()
    await page.waitForTimeout(300)
    // Page is still functional after date navigation
    const panel = page.locator('[role="tabpanel"]').first()
    await expect(panel).toBeVisible()
  })

  test('CSV export button exists', async ({ page }) => {
    const csvBtn = page.locator('button[title="Exporter en CSV"]').first()
    await expect(csvBtn).toBeVisible({ timeout: 10_000 })
    await expect(csvBtn).toBeEnabled()
  })
})
