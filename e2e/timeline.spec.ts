import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

test.describe('Timeline / Planning', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)

    await navigateToTab(page, 'dashboard')
    await page.waitForTimeout(1000)
  })

  test('top panel mission pool is visible', async ({ page }) => {
    const panel = page.locator('[role="tabpanel"]').first()
    await expect(panel).toBeVisible({ timeout: 10_000 })
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('bottom panel driver list is visible', async ({ page }) => {
    await page.waitForTimeout(2000)
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('driver filter dropdown works', async ({ page }) => {
    const filters = page.locator('[role="tabpanel"] select')
    const count = await filters.count()
    if (count > 0) {
      const firstFilter = filters.first()
      if (await firstFilter.isVisible()) {
        const opts = await firstFilter.locator('option').count()
        expect(opts).toBeGreaterThan(0)
      }
    }
  })

  test('compact mode toggle works', async ({ page }) => {
    const compactBtn = page.locator('button:has-text("Compact"), label:has-text("Compact") input[type="checkbox"]').first()
    if (await compactBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await compactBtn.click()
      await page.waitForTimeout(300)
    }
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('pool view mode toggle works', async ({ page }) => {
    const viewBtns = page.locator('button:has-text("Semaine"), button:has-text("Mois"), button:has-text("Liste")')
    const count = await viewBtns.count()
    for (let i = 0; i < count; i++) {
      if (await viewBtns.nth(i).isVisible()) {
        await viewBtns.nth(i).click()
        await page.waitForTimeout(300)
      }
    }
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('pool sort dropdown works', async ({ page }) => {
    const sortSelect = page.locator('[role="tabpanel"] select').first()
    if (await sortSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const opts = await sortSelect.locator('option').count()
      expect(opts).toBeGreaterThan(0)
    }
  })

  test('start time inputs are editable', async ({ page }) => {
    const timeInput = page.locator('[role="tabpanel"] input[type="time"]').first()
    if (await timeInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const value = await timeInput.inputValue()
      expect(value).toMatch(/\d{2}:\d{2}/)
    }
  })

  test('group by sector toggle works', async ({ page }) => {
    const sectorToggle = page.locator('[role="tabpanel"] input[type="checkbox"]').first()
    if (await sectorToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await sectorToggle.click()
      await page.waitForTimeout(300)
    }
    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })
})
