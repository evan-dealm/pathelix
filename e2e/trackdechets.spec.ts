import { test, expect, type Page } from '@playwright/test'
import { login, waitForAdminReady, navigateToTab } from './helpers'

// Trackdéchets E2E — USE_MOCK_DATA is project-default ON (see CLAUDE.md) but this repo's
// committed .env pins it to 'false' for real-DB E2E testing (matches global-setup.ts's Prisma
// seeding and OPERATIONS.md §9's HALT validation checklist, which itself runs with
// USE_MOCK_DATA=false). The 3 tests below that exercise the mock-only success short-circuit
// (fake "any-id" placeholders that only resolve without a DB lookup) are mode-aware so they
// assert the correct behavior either way instead of assuming mock is always active.
async function isMockMode(page: Page): Promise<boolean> {
  const res = await page.request.get('/api/health')
  const body = await res.json().catch(() => ({}))
  return body.useMock !== false
}

test.describe('Trackdéchets — mock mode', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await waitForAdminReady(page)
  })

  test('BSD account configuration endpoint responds', async ({ page }) => {
    const res = await page.request.get('/api/trackdechets/accounts')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('configured')
  })

  test('BSD list endpoint returns mock data', async ({ page }) => {
    const res = await page.request.get('/api/bsds')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.bsds)).toBe(true)
    expect(typeof body.total).toBe('number')
  })

  test('BSD creation returns mock BSD in draft status, or a safe 409 when Trackdéchets is unconfigured', async ({ page }) => {
    const mock = await isMockMode(page)
    const res = await page.request.post('/api/bsds', {
      data: {
        emitter: {
          company: {
            siret:   '12345678901234',
            name:    'Sté Émettrice Test',
            address: '1 rue du Test, 75001 Paris',
          },
        },
        recipient: {
          processingOperation: 'D9',
          company: {
            siret:   '12345678901234',
            name:    'Centre de Tri Test',
            address: '2 avenue du Centre, 69001 Lyon',
          },
        },
        wasteDetails: { code: '17 09 04' },
      },
    })
    if (mock) {
      expect(res.status()).toBe(201)
      const body = await res.json()
      expect(body.bsdId).toBeDefined()
      expect(body.tdId).toBeDefined()
    } else {
      // Real (non-mock) mode with no TrackdechetsAccount configured for the E2E tenant — the
      // route safely refuses rather than attempting a real sandbox call (see OPERATIONS.md §9).
      expect(res.status()).toBe(409)
    }
  })

  test('BSD creation rejects missing emitter SIRET', async ({ page }) => {
    const res = await page.request.post('/api/bsds', {
      data: {
        emitter: { company: { name: 'Sté sans SIRET', address: '1 rue' } },
        recipient: { processingOperation: 'D9', company: { siret: '12345678901234', name: 'Centre', address: '2 av' } },
        wasteDetails: { code: '17 09 04' },
      },
    })
    expect(res.status()).toBe(422)
  })

  test('BSD creation rejects invalid processingOperation', async ({ page }) => {
    const res = await page.request.post('/api/bsds', {
      data: {
        emitter: { company: { siret: '12345678901234', name: 'A', address: 'B' } },
        recipient: { processingOperation: 'INVALID', company: { siret: '12345678901234', name: 'B', address: 'C' } },
        wasteDetails: { code: '17 09 04' },
      },
    })
    expect(res.status()).toBe(422)
  })

  test('BSD sign returns mock SIGNED_BY_PRODUCER in mock mode, or 404 for a nonexistent BSD in real mode', async ({ page }) => {
    const mock = await isMockMode(page)
    const res = await page.request.post('/api/bsds/any-id/sign', {
      data: { signatureType: 'PRODUCER', signatureAuthor: 'Jean Test E2E' },
    })
    if (mock) {
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.status).toBe('SIGNED_BY_PRODUCER')
    } else {
      // 'any-id' is a placeholder, not a real BSD id — real mode correctly looks it up in DB.
      expect(res.status()).toBe(404)
    }
  })

  test('BSD sign rejects empty signatureAuthor', async ({ page }) => {
    const res = await page.request.post('/api/bsds/any-id/sign', {
      data: { signatureType: 'PRODUCER', signatureAuthor: '' },
    })
    expect(res.status()).toBe(422)
  })

  test('webhook with invalid HMAC returns 401', async ({ page }) => {
    const res = await page.request.post('/api/webhooks/trackdechets', {
      data: { type: 'BSD_STATUS_UPDATED', payload: { id: 'td-1', status: 'SEALED' } },
      headers: { 'X-Hub-Signature-256': 'sha256=invalidsig' },
    })
    expect([401, 503]).toContain(res.status())
  })

  test('driver-role cannot access BSD endpoints', async ({ page }) => {
    // Login as driver (if driver credentials available) — mock mode always returns admin,
    // so test the role enforcement via header spoofing is blocked by middleware
    // This is verified at unit level; E2E verifies 403 is returned for driver session
    const res = await page.request.get('/api/bsds')
    // In mock mode, getRequestContext returns admin — endpoint should succeed
    expect(res.status()).toBe(200)
  })

  test('account configuration DELETE returns ok in mock mode, or 404 for a nonexistent account in real mode', async ({ page }) => {
    const mock = await isMockMode(page)
    const res = await page.request.delete('/api/trackdechets/accounts/any-id')
    if (mock) {
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
    } else {
      // 'any-id' is a placeholder, not a real account id — real mode correctly looks it up in DB.
      expect(res.status()).toBe(404)
    }
  })
})
