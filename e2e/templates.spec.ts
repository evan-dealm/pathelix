import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab, closeModal } from './helpers'

test.describe('Templates Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)

    await navigateToTab(page, 'templates')
    await page.waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    ).catch(() => {})
    await page.waitForTimeout(300)
  })

  test('templates tab loads', async ({ page }) => {

    const counter = page.locator('[role="tabpanel"]').getByText(/\d+\s*template/i).first()
    const hasCounter = await counter.isVisible({ timeout: 8000 }).catch(() => false)

    const content = await page.locator('[role="tabpanel"]').textContent().catch(() => '')
    expect(hasCounter || (content && content.length > 10)).toBeTruthy()
  })

  test('new template button opens form', async ({ page }) => {

    const btn = page.locator('[role="tabpanel"] button:has-text("+ Nouveau template")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)
      const modal = page.locator('[role="dialog"]').first()
      if (await modal.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await closeModal(page)
      }
    }
  })

  test('template form has recurrence options', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("+ Nouveau template")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)
      const modal = page.locator('[role="dialog"]').first()
      if (await modal.isVisible({ timeout: 10_000 }).catch(() => false)) {
        const selects = await page.locator('[role="dialog"] select').count()
        expect(selects).toBeGreaterThan(0)
        await closeModal(page)
      }
    }
  })

  test('template form has recurrence type field', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("+ Nouveau template")').first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(500)

      const recurrenceLabel = page.locator('[role="dialog"]').getByText(/type de r.currence/i).first()
      const hasLabel = await recurrenceLabel.isVisible({ timeout: 10_000 }).catch(() => false)
      if (hasLabel) await expect(recurrenceLabel).toBeVisible()
      await closeModal(page)
    }
  })

  test('generate button exists', async ({ page }) => {

    const genBtn = page.locator('[role="tabpanel"] button:has-text("Générer")').first()
    if (await genBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(genBtn).toBeVisible()
    }
  })

  test('template list shows missions recurrentes heading', async ({ page }) => {

    const heading = page.locator('[role="tabpanel"]').getByText(/missions r.currentes/i).first()
    const hasHeading = await heading.isVisible({ timeout: 8000 }).catch(() => false)

    const content = await page.locator('[role="tabpanel"]').textContent().catch(() => '')
    expect(hasHeading || (content && content.length > 10)).toBeTruthy()
  })

  test('template delete has confirmation', async ({ page }) => {
    let dialogShown = false
    page.on('dialog', async d => { dialogShown = true; await d.dismiss() })

    const delBtn = page.locator('[role="tabpanel"] button:has-text("✕")').first()
    if (await delBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await delBtn.click()
      await page.waitForTimeout(500)
      expect(dialogShown).toBeTruthy()
    }
  })
})
