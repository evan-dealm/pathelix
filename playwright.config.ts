import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  retries: 1,
  workers: 1,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
    },
  },
  webServer: {
    command: 'npm run dev:e2e',
    port: 3000,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      REDIS_DISABLED: 'true',
    },
  },
  projects: [

    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    {
      name: 'auth-tests',
      testMatch: /auth\.spec\.ts/,
      use: { browserName: 'chromium' },
    },

    {
      name: 'api-tests',
      testMatch: /api-crud\.spec\.ts/,
      use: { browserName: 'chromium' },
    },

    {
      name: 'chromium',
      testIgnore: /auth\.(spec|setup)\.ts|api-crud\.spec\.ts/,
      use: {
        browserName: 'chromium',
        storageState: 'e2e/.auth/state.json',
      },
      dependencies: ['setup'],
    },
  ],
})
