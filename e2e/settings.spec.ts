import { test, expect } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

async function goToGeneralSettings(page: import('@playwright/test').Page) {
  await navigateToTab(page, 'settings')
  await page.waitForFunction(
    () => (document.querySelector('[role="tabpanel"]')?.textContent ?? '').trim().length > 5,
    { timeout: 30_000 },
  ).catch(() => {})
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
    const vitesseLabel = page.locator('[role="tabpanel"]').getByText(/vitesse/i).first()
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
    const pwdSection = page.locator('[role="tabpanel"]').getByText(/mot de passe/i).first()
    await expect(pwdSection).toBeVisible({ timeout: 8_000 })
  })

  test('password change form has password inputs', async ({ page }) => {
    const pwdInputs = page.locator('[role="tabpanel"] input[type="password"]')
    const count = await pwdInputs.count()
    expect(count).toBeGreaterThanOrEqual(2)
    await pwdInputs.first().fill('short')
    await pwdInputs.nth(1).fill('short')
    const changeBtn = page.locator('[role="tabpanel"] button[type="submit"]:has-text("Modifier")').first()
    await expect(changeBtn).toBeVisible({ timeout: 5_000 })
    await changeBtn.click()
    await page.waitForTimeout(500)
    // Short password should trigger validation error
    const errorMsg = page.locator('[role="tabpanel"] [class*="red"], [role="tabpanel"] [role="alert"]').first()
    await expect(errorMsg).toBeVisible({ timeout: 5_000 })
  })

  test('holidays section exists', async ({ page }) => {
    const holidaysSection = page.locator('[role="tabpanel"]').getByText(/jours f.ri.s/i).first()
    await expect(holidaysSection).toBeVisible({ timeout: 8_000 })
  })

  test('holiday add button exists', async ({ page }) => {
    const addBtn = page.locator('[role="tabpanel"] button:has-text("Ajouter")').first()
    await expect(addBtn).toBeVisible({ timeout: 8_000 })
    await expect(addBtn).toBeEnabled()
  })

  test('backup export button exists', async ({ page }) => {
    const exportBtn = page.locator('[role="tabpanel"] button:has-text("Exporter")').first()
    await expect(exportBtn).toBeVisible({ timeout: 5_000 })
    await expect(exportBtn).toBeEnabled()
  })

  test('danger zone buttons exist', async ({ page }) => {
    const purgeBtn = page.locator('[role="tabpanel"] button:has-text("Purger les logs")').first()
    await expect(purgeBtn).toBeVisible({ timeout: 5_000 })
    await expect(purgeBtn).toBeEnabled()
  })

  test('danger zone buttons have confirmations', async ({ page }) => {
    let dialogShown = false
    page.on('dialog', async dialog => {
      dialogShown = true
      await dialog.dismiss()
    })
    const purgeBtn = page.locator('[role="tabpanel"] button:has-text("Purger les logs")').first()
    await expect(purgeBtn).toBeVisible({ timeout: 5_000 })
    await purgeBtn.click()
    await page.waitForTimeout(500)
    expect(dialogShown).toBe(true)
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
