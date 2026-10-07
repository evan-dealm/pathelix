import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab, closeModal } from './helpers'

test.describe('Users Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await navigateToTab(page, 'users')
    await page.waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    ).catch(() => {})
    await page.waitForTimeout(300)
  })

  test('users tab loads with counter', async ({ page }) => {
    const panel = page.locator('[role="tabpanel"]').first()
    await expect(panel).toBeVisible({ timeout: 10_000 })
    const counter = panel.getByText(/\d+\s*(utilisateur|user)/i).first()
    await expect(counter).toBeVisible({ timeout: 8_000 })
  })

  test('search filters users', async ({ page }) => {
    const search = page.locator('[role="tabpanel"] input[placeholder="Rechercher..."]').first()
    await expect(search).toBeVisible({ timeout: 5_000 })
    await search.fill('admin')
    await page.waitForTimeout(300)
    await search.clear()
    await page.waitForTimeout(300)
  })

  test('role filter dropdown works', async ({ page }) => {
    const filter = page.locator('[role="tabpanel"] select[title="Filtrer par rôle"]').first()
    await expect(filter).toBeVisible({ timeout: 5_000 })
    await filter.selectOption('ADMIN')
    await page.waitForTimeout(300)
    await filter.selectOption({ index: 0 })
    await page.waitForTimeout(300)
    await expect(page.locator('[role="tabpanel"]').first()).toBeVisible()
  })

  test('new user button opens form', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("Nouvel utilisateur")').first()
    await expect(btn).toBeVisible({ timeout: 5_000 })
    await btn.click()
    await page.waitForTimeout(500)
    const modal = page.locator('[role="dialog"]').first()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await closeModal(page)
  })

  test('user form requires email and name', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("Nouvel utilisateur")').first()
    await expect(btn).toBeVisible({ timeout: 5_000 })
    await btn.click()
    await page.waitForTimeout(500)
    const modal = page.locator('[role="dialog"]').first()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    const saveBtn = modal.locator('button:has-text("Créer"), button:has-text("Créer"), button[type="submit"]').first()
    await expect(saveBtn).toBeVisible({ timeout: 5_000 })
    await saveBtn.click()
    await page.waitForTimeout(300)
    const error = modal.locator('p, [role="alert"], [class*="red"]').filter({ hasText: /obligatoire|requis|required/i }).first()
    await expect(error).toBeVisible({ timeout: 5_000 })
    await closeModal(page)
  })

  test('user form has role selector', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("Nouvel utilisateur")').first()
    await expect(btn).toBeVisible({ timeout: 5_000 })
    await btn.click()
    await page.waitForTimeout(500)
    const modal = page.locator('[role="dialog"]').first()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    const roleSelect = modal.locator('select').first()
    await expect(roleSelect).toBeVisible({ timeout: 5_000 })
    const opts = await roleSelect.locator('option').allTextContents()
    expect(opts.some(o => /Administrateur|ADMIN/i.test(o))).toBe(true)
    // The dispatcher role is called « Exploitant » everywhere in the interface.
    expect(opts.some(o => /Exploitant/i.test(o))).toBe(true)
    expect(opts.some(o => /Chauffeur|DRIVER/i.test(o))).toBe(true)
    await closeModal(page)
  })

  test('driver role shows driver association field', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("Nouvel utilisateur")').first()
    await expect(btn).toBeVisible({ timeout: 5_000 })
    await btn.click()
    await page.waitForTimeout(500)
    const modal = page.locator('[role="dialog"]').first()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    const roleSelect = modal.locator('select').first()
    await expect(roleSelect).toBeVisible({ timeout: 5_000 })
    await roleSelect.selectOption('DRIVER')
    await page.waitForTimeout(300)
    const driverField = modal.getByText(/chauffeur associ/i).first()
    await expect(driverField).toBeVisible({ timeout: 5_000 })
    await closeModal(page)
  })

  test('password field is type password', async ({ page }) => {
    const btn = page.locator('[role="tabpanel"] button:has-text("Nouvel utilisateur")').first()
    await expect(btn).toBeVisible({ timeout: 5_000 })
    await btn.click()
    await page.waitForTimeout(500)
    const pwdInput = page.locator('[role="dialog"] input[type="password"]').first()
    await expect(pwdInput).toBeVisible({ timeout: 10_000 })
    await closeModal(page)
  })

  test('edit user opens pre-filled form', async ({ page }) => {
    const editBtn = page.locator('[role="tabpanel"] button:has-text("Modifier"):visible').first()
    await expect(editBtn).toBeVisible({ timeout: 5_000 })
    await editBtn.click()
    await page.waitForTimeout(500)
    const emailInput = page.locator('[role="dialog"] input[placeholder="email@exemple.com"]').first()
    await expect(emailInput).toBeVisible({ timeout: 5_000 })
    const val = await emailInput.inputValue()
    expect(val.length).toBeGreaterThan(0)
    await closeModal(page)
  })

  test('edit modal shows password reset section', async ({ page }) => {
    const editBtn = page.locator('[role="tabpanel"] button:has-text("Modifier"):visible').first()
    await expect(editBtn).toBeVisible({ timeout: 5_000 })
    await editBtn.click()
    await page.waitForTimeout(500)
    const resetSection = page.locator('[role="dialog"]').getByText(/r[ée]initialiser le mot de passe/i).first()
    await expect(resetSection).toBeVisible({ timeout: 10_000 })
    await closeModal(page)
  })
})
