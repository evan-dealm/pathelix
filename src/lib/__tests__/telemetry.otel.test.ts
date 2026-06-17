import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// File-scoped vi.fn() handles captured by mock factories via closure.
// vi.clearAllMocks() only clears call history, not implementations — safe to use here.
const mockStart    = vi.fn()
const mockShutdown = vi.fn().mockResolvedValue(undefined)

const mockSpanSetAttribute = vi.fn()
const mockSpanSetStatus    = vi.fn()
const mockSpanEnd          = vi.fn()

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn().mockImplementation(() => ({ start: mockStart, shutdown: mockShutdown })),
}))

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: vi.fn().mockReturnValue({}),
}))

vi.mock('@opentelemetry/semantic-conventions', () => ({
  SEMRESATTRS_SERVICE_NAME:    'service.name',
  SEMRESATTRS_SERVICE_VERSION: 'service.version',
}))

vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: vi.fn().mockReturnValue([]),
}))

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: vi.fn().mockReturnValue({
      startActiveSpan: vi.fn().mockImplementation(
        (_name: string, fn: (span: unknown) => unknown) =>
          fn({ setAttribute: mockSpanSetAttribute, setStatus: mockSpanSetStatus, end: mockSpanEnd }),
      ),
    }),
  },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}))

beforeEach(() => {
  // clearAllMocks: wipes call history but preserves implementations in factory-created mocks
  vi.clearAllMocks()
  // resetModules: ensures each test gets _initialized=false in a fresh module instance
  vi.resetModules()
})

afterEach(() => {
  delete process.env.OTEL_ENABLED
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  process.removeAllListeners('SIGTERM')
})

describe('initTelemetry — OTEL_ENABLED=true', () => {
  it('starts NodeSDK when OTEL_ENABLED is true', async () => {
    process.env.OTEL_ENABLED = 'true'
    const { initTelemetry } = await import('@/lib/telemetry')
    await initTelemetry()
    expect(mockStart).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — second call does not re-start SDK', async () => {
    process.env.OTEL_ENABLED = 'true'
    const { initTelemetry } = await import('@/lib/telemetry')
    await initTelemetry()
    await initTelemetry()
    expect(mockStart).toHaveBeenCalledTimes(1)
  })

  it('uses custom OTLP endpoint env var', async () => {
    process.env.OTEL_ENABLED = 'true'
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel.example.com:4318/v1/traces'
    const { initTelemetry } = await import('@/lib/telemetry')
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
    await initTelemetry()
    expect(OTLPTraceExporter).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://otel.example.com:4318/v1/traces' }),
    )
  })

  it('registers SIGTERM handler after init', async () => {
    process.env.OTEL_ENABLED = 'true'
    const addListenerSpy = vi.spyOn(process, 'on')
    const { initTelemetry } = await import('@/lib/telemetry')
    await initTelemetry()
    expect(addListenerSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    addListenerSpy.mockRestore()
  })

  it('does not start SDK when OTEL_ENABLED is missing', async () => {
    const { initTelemetry } = await import('@/lib/telemetry')
    await initTelemetry()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('does not start SDK when OTEL_ENABLED is "false"', async () => {
    process.env.OTEL_ENABLED = 'false'
    const { initTelemetry } = await import('@/lib/telemetry')
    await initTelemetry()
    expect(mockStart).not.toHaveBeenCalled()
  })
})

describe('withSpan — after successful initTelemetry', () => {
  async function initAndGet() {
    process.env.OTEL_ENABLED = 'true'
    const mod = await import('@/lib/telemetry')
    await mod.initTelemetry()
    return mod
  }

  it('calls fn and returns its result via span', async () => {
    const { withSpan } = await initAndGet()
    const result = await withSpan('op.name', { key: 'val' }, async () => 42)
    expect(result).toBe(42)
  })

  it('sets span attributes before calling fn', async () => {
    const { withSpan } = await initAndGet()
    await withSpan('op', { count: 3, flag: true }, async () => 'done')
    expect(mockSpanSetAttribute).toHaveBeenCalledWith('count', 3)
    expect(mockSpanSetAttribute).toHaveBeenCalledWith('flag', true)
  })

  it('sets OK status after successful fn', async () => {
    const { withSpan } = await initAndGet()
    await withSpan('op', {}, async () => 'ok')
    expect(mockSpanSetStatus).toHaveBeenCalledWith({ code: 1 })
  })

  it('ends span after successful fn', async () => {
    const { withSpan } = await initAndGet()
    await withSpan('op', {}, async () => 'ok')
    expect(mockSpanEnd).toHaveBeenCalled()
  })

  it('sets ERROR status when fn throws', async () => {
    const { withSpan } = await initAndGet()
    await withSpan('op', {}, async () => { throw new Error('boom') }).catch(() => {})
    expect(mockSpanSetStatus).toHaveBeenCalledWith(
      expect.objectContaining({ code: 2, message: 'Error: boom' }),
    )
  })

  it('ends span even when fn throws', async () => {
    const { withSpan } = await initAndGet()
    await withSpan('op', {}, async () => { throw new Error('boom') }).catch(() => {})
    expect(mockSpanEnd).toHaveBeenCalled()
  })

  it('propagates the error from fn', async () => {
    const { withSpan } = await initAndGet()
    await expect(
      withSpan('op', {}, async () => { throw new Error('propagated') }),
    ).rejects.toThrow('propagated')
  })
})

describe('spanVrpStep and spanDbQuery — delegation wrappers', () => {
  it('spanVrpStep returns fn result and uses span', async () => {
    process.env.OTEL_ENABLED = 'true'
    const { initTelemetry, spanVrpStep } = await import('@/lib/telemetry')
    await initTelemetry()
    const result = await spanVrpStep('optimize', 'tenant-42', async () => 'done')
    expect(result).toBe('done')
    // Span was used — end() called
    expect(mockSpanEnd).toHaveBeenCalled()
  })

  it('spanVrpStep passes tenant attribute to span', async () => {
    process.env.OTEL_ENABLED = 'true'
    const { initTelemetry, spanVrpStep } = await import('@/lib/telemetry')
    await initTelemetry()
    await spanVrpStep('build-matrix', 'tenant-99', async () => null)
    expect(mockSpanSetAttribute).toHaveBeenCalledWith('pathelix.tenant_id', 'tenant-99')
  })

  it('spanDbQuery returns fn result and uses span', async () => {
    process.env.OTEL_ENABLED = 'true'
    const { initTelemetry, spanDbQuery } = await import('@/lib/telemetry')
    await initTelemetry()
    const result = await spanDbQuery('driver', 'findMany', async () => [1, 2, 3])
    expect(result).toEqual([1, 2, 3])
    expect(mockSpanEnd).toHaveBeenCalled()
  })

  it('spanDbQuery passes table and operation attributes to span', async () => {
    process.env.OTEL_ENABLED = 'true'
    const { initTelemetry, spanDbQuery } = await import('@/lib/telemetry')
    await initTelemetry()
    await spanDbQuery('mission', 'upsert', async () => null)
    expect(mockSpanSetAttribute).toHaveBeenCalledWith('db.table', 'mission')
    expect(mockSpanSetAttribute).toHaveBeenCalledWith('db.operation', 'upsert')
  })
})
