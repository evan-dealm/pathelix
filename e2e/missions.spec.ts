import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab, closeModal } from './helpers'

test.describe('Missions Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'missions')
    // The empty-table timeouts once blamed on render/data timing here were actually
    // DataProvider fetching the wrong day's missions near local midnight (UTC vs local "today"
    // mismatch, see src/providers/DataProvider.tsx) — fixed at the source, so this is back to a
    // plain render-completion wait.
    await page.locator('[role="tabpanel"] tbody tr').first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(300)
  })

  test('missions tab loads with counter', async ({ page }) => {
    const panel = page.locator('[role="tabpanel"]').first()
    await expect(panel).toBeVisible()
    // The toolbar counter reads « shown/total » (e.g. 9/9).
    await expect(panel.getByText(/^\d+\/\d+$/).first()).toBeVisible({ timeout: 5_000 })
  })

  test('search input filters missions', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Rechercher" i]').first()
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await searchInput.fill('xxxxxxxxnotfound')
    await page.waitForTimeout(500)
    const rows = page.locator('[role="tabpanel"] tbody tr')
    const rowCount = await rows.count()
    // Either 0 rows (filtered out) or an empty state message
    if (rowCount > 0) {
      const emptyMsg = page.locator('[role="tabpanel"]').getByText(/Aucune mission|Aucun résultat/i).first()
      const hasEmpty = await emptyMsg.isVisible({ timeout: 2_000 }).catch(() => false)
      expect(rowCount === 0 || hasEmpty).toBe(true)
    }
    await searchInput.clear()
  })

  test('type filter dropdown works', async ({ page }) => {
    const typeFilter = page.locator('select[aria-label="Filtrer par type de mission"], select[title="Filtrer par type de mission"]').first()
    const filtersBtn = page.locator('button:has-text("Filtres")').first()
    if (await filtersBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await filtersBtn.click()
      await page.waitForTimeout(300)
    }
    await expect(typeFilter).toBeVisible({ timeout: 5_000 })
    const options = await typeFilter.locator('option').count()
    expect(options).toBeGreaterThan(1)
    await typeFilter.selectOption({ index: 1 })
    await page.waitForTimeout(300)
    await expect(page.locator('[role="tabpanel"]').first()).toBeVisible()
  })

  test('new mission button opens form', async ({ page }) => {
    const newBtn = page.locator('button:has-text("Nouvelle mission"), button:has-text("+ Nouvelle")').first()
    await expect(newBtn).toBeVisible({ timeout: 5_000 })
    await newBtn.click()
    await page.waitForTimeout(500)
    const modal = page.locator('[role="dialog"]').first()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await closeModal(page)
  })

  test('mission form has required fields', async ({ page }) => {
    const newBtn = page.locator('button:has-text("Nouvelle mission"), button:has-text("+ Nouvelle")').first()
    await expect(newBtn).toBeVisible({ timeout: 5_000 })
    await newBtn.click()
    await page.waitForTimeout(500)
    const modal = page.locator('[role="dialog"]').first()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    const typeSelect = modal.locator('select').first()
    await expect(typeSelect).toBeVisible({ timeout: 5_000 })
    await closeModal(page)
  })

  test('mission form validates required fields', async ({ page }) => {
    const newBtn = page.locator('button:has-text("Nouvelle mission"), button:has-text("+ Nouvelle")').first()
    await expect(newBtn).toBeVisible({ timeout: 5_000 })
    await newBtn.click()
    await page.waitForTimeout(500)
    const modal = page.locator('[role="dialog"]').first()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    const saveBtn = modal.locator('button:has-text("Enregistrer"), button[type="submit"]').first()
    await expect(saveBtn).toBeVisible({ timeout: 5_000 })
    await saveBtn.click()
    await page.waitForTimeout(500)
    // Form must show validation error
    const errorText = modal.locator('[class*="red"], [class*="error"], [role="alert"]').first()
    await expect(errorText).toBeVisible({ timeout: 5_000 })
    await closeModal(page)
  })

  test('bulk selection checkbox works', async ({ page }) => {
    const selectAll = page.locator('input[aria-label="Sélectionner toutes les missions"]').first()
    await expect(selectAll).toBeVisible({ timeout: 5_000 })
    await selectAll.click()
    await page.waitForTimeout(200)
    await expect(selectAll).toBeChecked()
    await selectAll.click()
    await page.waitForTimeout(200)
    await expect(selectAll).not.toBeChecked()
  })

  test('pagination controls work', async ({ page }) => {
    const panel = page.locator('[role="tabpanel"]').first()
    const shown = Number(((await panel.getByText(/^\d+\/\d+$/).first().textContent()) ?? '').split('/')[0])
    const range = panel.getByText(/^\d+-\d+ sur \d+$/).first()
    if (await range.isVisible().catch(() => false)) {
      // More than one page: « > » moves to the next range.
      const before = await range.textContent()
      await panel.getByRole('button', { name: '>', exact: true }).click()
      await expect(range).not.toHaveText(before ?? '')
    } else {
      // A single page has no pager, and every counted mission is a row of the table.
      await expect(panel.locator('tbody tr')).toHaveCount(shown)
    }
  })

  test('sort by priority works', async ({ page }) => {
    const sortHeader = page.locator('th button:has-text("P.")').first()
    await expect(sortHeader).toBeVisible({ timeout: 5_000 })
    await sortHeader.click()
    await page.waitForTimeout(300)
    // Rows still present after sort
    const rows = page.locator('[role="tabpanel"] tbody tr')
    await expect(rows.first()).toBeVisible({ timeout: 5_000 })
  })

  test('an archived mission is listed under Archives and can be restored', async ({ page }) => {
    // The Archives section only exists once something is archived: go through the real flow.
    const panel = page.locator('[role="tabpanel"]').first()
    const rows = panel.locator('tbody tr')
    const before = await rows.count()
    await rows.first().locator('button[title="Archiver"]').click()
    await expect(rows).toHaveCount(before - 1)
    const archiveToggle = panel.locator('button:has-text("Archives (")').first()
    await expect(archiveToggle).toBeVisible({ timeout: 5_000 })
    await archiveToggle.click()
    const restore = panel.locator('button[title="Restaurer"]').first()
    await expect(restore).toBeVisible({ timeout: 5_000 })
    await restore.click()
    await expect(rows).toHaveCount(before)
  })
})
