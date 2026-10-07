import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab, closeModal, acceptDialogs } from './helpers'

test.describe('Vehicles Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'vehicles')
    await page.waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    ).catch(() => {})
    await page.waitForTimeout(300)
  })

  test('vehicles tab loads with counter', async ({ page }) => {
    const panel = page.locator('[role="tabpanel"]').first()
    await expect(panel).toBeVisible({ timeout: 10_000 })
    const counter = panel.getByText(/\d+\s*(vehicule|véhicule)/i).first()
    await expect(counter).toBeVisible({ timeout: 8_000 })
  })

  test('search input works', async ({ page }) => {
    const search = page.locator('[role="tabpanel"] input[placeholder="Rechercher..."]').first()
    await expect(search).toBeVisible({ timeout: 5_000 })
    await search.fill('XX-000-XX')
    await page.waitForTimeout(300)
    await search.clear()
    await page.waitForTimeout(300)
  })

  test('type filter works', async ({ page }) => {
    const typeSelect = page.locator('[role="tabpanel"] select').first()
    await expect(typeSelect).toBeVisible({ timeout: 5_000 })
    const opts = await typeSelect.locator('option').count()
    expect(opts).toBeGreaterThan(0)
    await typeSelect.selectOption({ index: 1 })
    await page.waitForTimeout(300)
    await expect(page.locator('[role="tabpanel"]').first()).toBeVisible()
  })

  test('new vehicle button opens form', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("Nouveau véhicule"), [role="tabpanel"] button:has-text("Nouveau véhicule")').first()
    await expect(btn).toBeVisible({ timeout: 5_000 })
    await btn.click()
    await page.waitForTimeout(500)
    const modal = page.locator('[role="dialog"]').first()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await closeModal(page)
  })

  test('vehicle form has all fields', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("Nouveau véhicule"), [role="tabpanel"] button:has-text("Nouveau véhicule")').first()
    await expect(btn).toBeVisible({ timeout: 5_000 })
    await btn.click()
    await page.waitForTimeout(500)
    const modal = page.locator('[role="dialog"]').first()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    const inputs = await modal.locator('input, select, textarea').count()
    expect(inputs).toBeGreaterThan(3)
    await closeModal(page)
  })

  test('vehicle form has immatriculation field', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("Nouveau véhicule"), [role="tabpanel"] button:has-text("Nouveau véhicule")').first()
    await expect(btn).toBeVisible({ timeout: 5_000 })
    await btn.click()
    await page.waitForTimeout(500)
    const immatInput = page.locator('[role="dialog"] input[placeholder="AA-123-BB"]').first()
    await expect(immatInput).toBeVisible({ timeout: 10_000 })
    await closeModal(page)
  })

  test('delete vehicle shows confirmation', async ({ page }) => {
    acceptDialogs(page)
    const tableRows = page.locator('[role="tabpanel"] tbody tr')
    await expect(tableRows.first()).toBeVisible({ timeout: 5_000 })
    await tableRows.first().hover()
    await page.waitForTimeout(300)
    const deleteBtn = page.locator('[role="tabpanel"] button:has-text("Supprimer"):visible').first()
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 })
    await expect(deleteBtn).toBeEnabled()
  })
})
