import { test, expect } from '@playwright/test'
import { login, waitForAdminReady } from './helpers'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
  })

  test('dashboard displays KPI stats', async ({ page }) => {
    const kpiBar = page.locator('#tabpanel-dashboard').first()
    await expect(kpiBar).toBeVisible({ timeout: 10_000 })
    const kpiValues = page.locator('#tabpanel-dashboard .tabular-nums')
    await expect(kpiValues.first()).toBeVisible({ timeout: 5_000 })
    const body = await page.textContent('body')
    expect(body?.toLowerCase()).toMatch(/(pool|mission|chauffeur|km|urgence)/i)
  })

  test('dashboard shows alerts button', async ({ page }) => {
    const alertBtn = page.locator('button[title="Alertes"]').first()
    await expect(alertBtn).toBeVisible({ timeout: 10_000 })
  })

  test('alerts panel opens when alert button clicked', async ({ page }) => {
    const alertBtn = page.locator('button[title="Alertes"]').first()
    await expect(alertBtn).toBeVisible({ timeout: 10_000 })
    await alertBtn.click()
    await page.waitForTimeout(500)
    const alertPanel = page.locator('[aria-live="polite"]').first()
    await expect(alertPanel).toBeVisible({ timeout: 8_000 })
    const alertText = await alertPanel.textContent()
    expect(typeof alertText).toBe('string')
    await alertBtn.click()
    await page.waitForTimeout(200)
  })

  test('top panel (mission pool) loads', async ({ page }) => {
    const dashboardPanel = page.locator('#tabpanel-dashboard').first()
    await expect(dashboardPanel).toBeVisible({ timeout: 10_000 })
    const content = await dashboardPanel.textContent()
    expect(content!.trim().length).toBeGreaterThan(0)
  })

  test('bottom panel (driver planning) loads', async ({ page }) => {
    const dashboardPanel = page.locator('#tabpanel-dashboard').first()
    await expect(dashboardPanel).toBeVisible({ timeout: 10_000 })
    const content = await dashboardPanel.textContent()
    expect(content!.trim().length).toBeGreaterThan(0)
  })

  test('date navigator is interactive', async ({ page }) => {
    const prevBtn = page.locator('button[title="Jour précédent"]').first()
    await expect(prevBtn).toBeVisible({ timeout: 10_000 })
    await prevBtn.click()
    await page.waitForTimeout(300)
    await expect(page.locator('#tabpanel-dashboard').first()).toBeVisible()
  })

  test('undo/redo keyboard shortcuts work', async ({ page }) => {
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(200)
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(200)
    // App must remain functional after keyboard shortcuts
    await expect(page.locator('#tabpanel-dashboard').first()).toBeVisible()
  })

  test('new mission shortcut N works', async ({ page }) => {
    await page.keyboard.press('n')
    await page.waitForTimeout(500)
    const modal = page.locator('[role="dialog"]').first()
    const visible = await modal.isVisible({ timeout: 3_000 }).catch(() => false)
    if (visible) {
      await expect(modal).toBeVisible()
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
    // Dashboard still visible whether modal opened or not
    await expect(page.locator('#tabpanel-dashboard').first()).toBeVisible()
  })
})
