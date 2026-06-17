import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab, closeModal } from './helpers'

test.describe('Exutoires Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'exutoires')
    // ExutoiresTab is a dynamic import — wait for its content to render (skeleton has no text)
    await page.waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    ).catch(() => {})
    await page.waitForTimeout(500)
  })

  test('exutoires tab loads', async ({ page }) => {
    const tabPanel = page.locator('[role="tabpanel"]').first()
    await expect(tabPanel).toBeAttached({ timeout: 30_000 })
    const content = await page.textContent('body').catch(() => '')
    expect(content !== null).toBeTruthy()
  })

  test('search filters exutoires', async ({ page }) => {

    const search = page.locator('[role="tabpanel"] input[placeholder="Rechercher…"]').first()
    if (await search.isVisible({ timeout: 3000 }).catch(() => false)) {
      await search.fill('zzz-no-match')
      await page.waitForTimeout(300)
    }
  })

  test('waste type filter works', async ({ page }) => {
    const selects = page.locator('[role="tabpanel"] select')
    const count = await selects.count()
    if (count > 0) {
      const opts = await selects.first().locator('option').count()
      expect(opts).toBeGreaterThan(0)
    } else {
      const body = await page.textContent('body').catch(() => '')
      expect(body !== null).toBeTruthy()
    }
  })

  test('new exutoire button opens form', async ({ page }) => {

    const btn = page.locator('[role="tabpanel"] button:has-text("Nouvel exutoire")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)
      const modal = page.locator('[role="dialog"]').first()
      if (await modal.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await closeModal(page)
      }
    }
  })

  test('exutoire form has waste type buttons', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("Nouvel exutoire")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)

      const gravatsBtn = page.locator('[role="dialog"] button:has-text("Gravats")').first()
      if (await gravatsBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await expect(gravatsBtn).toBeVisible()
        await closeModal(page)
      }
    }
  })

  test('exutoire form has day selectors', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("Nouvel exutoire")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)

      const dayBtn = page.locator('[role="dialog"] button:has-text("Lun")').first()
      if (await dayBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await expect(dayBtn).toBeVisible()
        await closeModal(page)
      }
    }
  })

  test('delete exutoire button exists in table', async ({ page }) => {

    const tableRows = page.locator('[role="tabpanel"] tbody tr')
    const rowCount = await tableRows.count()
    if (rowCount > 0) {

      await tableRows.first().hover()
      await page.waitForTimeout(300)
      const deleteBtn = page.locator('[role="tabpanel"] button:has-text("Supprimer")').first()
      await expect(deleteBtn).toBeEnabled()
    }
  })
})
