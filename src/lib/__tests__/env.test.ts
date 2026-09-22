import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const VALID_BASE = {
  DATABASE_URL:   'postgresql://user:pass@localhost:5432/db',
  SESSION_SECRET: 'a'.repeat(32),
}

function stubProcessExit() {
  // process.exit(1) must not actually kill the test runner — throw instead, so a test that
  // expects the guard to fire can assert on it without ending the whole suite.
  return vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit(${code})`)
  })
}

let exitSpy: ReturnType<typeof stubProcessExit>

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  exitSpy = stubProcessExit()
})

afterEach(() => {
  exitSpy.mockRestore()
  vi.unstubAllEnvs()
})

function stubEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) vi.stubEnv(k, '')
    else vi.stubEnv(k, v)
  }
}

describe('validateEnv — required variables', () => {
  it('exits when DATABASE_URL is missing', async () => {
    stubEnv({ ...VALID_BASE, DATABASE_URL: '', NODE_ENV: 'development' })
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow('process.exit(1)')
  })

  it('exits when SESSION_SECRET is missing', async () => {
    stubEnv({ ...VALID_BASE, SESSION_SECRET: '', NODE_ENV: 'development' })
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow('process.exit(1)')
  })

  it('exits when SESSION_SECRET is shorter than 32 characters', async () => {
    stubEnv({ ...VALID_BASE, SESSION_SECRET: 'too-short', NODE_ENV: 'development' })
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow('process.exit(1)')
  })

  it('succeeds with valid required variables in development', async () => {
    stubEnv({ ...VALID_BASE, NODE_ENV: 'development' })
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).not.toThrow()
  })
})

describe('validateEnv — mock mode fail-safe in production', () => {
  it('exits when NODE_ENV=production and USE_MOCK_DATA is unset (mock ON by default)', async () => {
    stubEnv({ ...VALID_BASE, NODE_ENV: 'production', USE_MOCK_DATA: undefined })
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow('process.exit(1)')
  })

  it('exits when NODE_ENV=production and USE_MOCK_DATA is anything other than the literal "false"', async () => {
    stubEnv({ ...VALID_BASE, NODE_ENV: 'production', USE_MOCK_DATA: 'true' })
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).toThrow('process.exit(1)')
  })

  it('succeeds when NODE_ENV=production and USE_MOCK_DATA=false', async () => {
    stubEnv({ ...VALID_BASE, NODE_ENV: 'production', USE_MOCK_DATA: 'false' })
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).not.toThrow()
  })

  it('does NOT exit in development even with mock active (USE_MOCK_DATA unset)', async () => {
    stubEnv({ ...VALID_BASE, NODE_ENV: 'development', USE_MOCK_DATA: undefined })
    const { validateEnv } = await import('../env')
    expect(() => validateEnv()).not.toThrow()
  })
})
