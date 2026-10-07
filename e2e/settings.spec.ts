import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

async function goToGeneralSettings(page: import('@playwright/test').Page) {
  await navigateToTab(page, 'settings')
  await page
    .waitForFunction(
      () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
      { timeout: 30_000 },
    )
    .catch(() => {})
  await page.waitForTimeout(300)
  const generalBtn = page.locator('[role="tabpanel"] button:has-text("Général")').first()
  if (await generalBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await generalBtn.click({ force: true })
    await page.waitForTimeout(500)
  }
}

test.describe('Settings Tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
    await goToGeneralSettings(page)
  })

  test('settings tab loads with vitesse label', async ({ page }) => {
    const vitesseLabel = page
      .locator('[role="tabpanel"]')
      .getByText(/vitesse/i)
      .first()
    await expect(vitesseLabel).toBeVisible({ timeout: 8_000 })
  })

  test('optimization settings fields are editable', async ({ page }) => {
    const speedInput = page.locator('[role="tabpanel"] input[title*="Vitesse"]').first()
    await expect(speedInput).toBeVisible({ timeout: 5_000 })
    const value = await speedInput.inputValue()
    expect(parseFloat(value)).toBeGreaterThan(0)
    await expect(speedInput).toBeEnabled()
  })

  test('save optimization settings button exists', async ({ page }) => {
    const saveBtn = page.locator('[role="tabpanel"] button:has-text("Enregistrer")').first()
    await expect(saveBtn).toBeVisible({ timeout: 8_000 })
    await expect(saveBtn).toBeEnabled()
  })

  test('password change section exists', async ({ page }) => {
    const pwdSection = page
      .locator('[role="tabpanel"]')
      .getByText(/mot de passe/i)
      .first()
    await expect(pwdSection).toBeVisible({ timeout: 8_000 })
  })

  test('password change form has password inputs', async ({ page }) => {
    const pwdInputs = page.locator('[role="tabpanel"] input[type="password"]')
    const count = await pwdInputs.count()
    expect(count).toBeGreaterThanOrEqual(3)
    await pwdInputs.first().fill('short')
    await pwdInputs.nth(1).fill('short')
    const changeBtn = page
      .locator('[role="tabpanel"] button[type="submit"]:has-text("Modifier")')
      .first()
    await expect(changeBtn).toBeVisible({ timeout: 5_000 })
    // Current, new and confirmation are all required before the form can be sent.
    await expect(changeBtn).toBeDisabled()
    await pwdInputs.nth(2).fill('short')
    await changeBtn.click()
    // A short password is refused with the rule, before any request.
    await expect(
      page.locator('[role="tabpanel"]').getByText('12 caractères au minimum'),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('holidays section exists', async ({ page }) => {
    const holidaysSection = page
      .locator('[role="tabpanel"]')
      .getByText(/jours f.ri.s/i)
      .first()
    await expect(holidaysSection).toBeVisible({ timeout: 8_000 })
  })

  test('holiday add button exists', async ({ page }) => {
    const addBtn = page.locator('[role="tabpanel"] button:has-text("Ajouter")').first()
    await expect(addBtn).toBeVisible({ timeout: 8_000 })
    // Disabled until the holiday has a date and a label.
    await expect(addBtn).toBeDisabled()
    await page
      .locator('[role="tabpanel"] input[type="date"]:not(#purge-plans-date)')
      .first()
      .fill('2027-05-01')
    await page.locator('[role="tabpanel"]').getByPlaceholder('Ex : Noël').fill('Fête du Travail')
    await expect(addBtn).toBeEnabled()
  })

  test('backup export button exists', async ({ page }) => {
    const exportBtn = page.locator('[role="tabpanel"] button:has-text("Exporter")').first()
    await expect(exportBtn).toBeVisible({ timeout: 5_000 })
    await expect(exportBtn).toBeEnabled()
  })

  test('admin zone: plans are erased per date, the audit log cannot be purged by hand', async ({
    page,
  }) => {
    const panel = page.locator('[role="tabpanel"]')
    await expect(panel.locator('button:has-text("Archiver toutes les missions")')).toBeEnabled({
      timeout: 5_000,
    })
    // Erasing plans is offered for one chosen day (today by default), never for everything.
    await expect(panel.locator('#purge-plans-date')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/)
    await expect(
      panel.locator('button:has-text("Effacer les tournées de cette date")'),
    ).toBeEnabled()
    // The manual purge of the audit log was removed on purpose (365-day retention only).
    await expect(panel.locator('button:has-text("Purger les logs")')).toHaveCount(0)
  })

  test('admin zone buttons ask for confirmation', async ({ page }) => {
    let message = ''
    page.on('dialog', async dialog => {
      message = dialog.message()
      await dialog.dismiss()
    })
    await page.locator('[role="tabpanel"] button:has-text("Archiver toutes les missions")').click()
    await expect.poll(() => message).toMatch(/Archiver TOUTES les missions/)
  })

  test('integrations sub-tab exists and is clickable', async ({ page }) => {
    const intTab = page.locator('[role="tabpanel"] button:has-text("Intégrations")').first()
    await expect(intTab).toBeVisible({ timeout: 5_000 })
    await intTab.click()
    await page.waitForTimeout(500)
    const panel = page.locator('[role="tabpanel"]').first()
    await expect(panel).toBeVisible()
    const content = await panel.textContent()
    expect(content!.trim().length).toBeGreaterThan(5)
  })
})
