import { createLogger } from '@/lib/logger'

const log = createLogger('telemetry')

let _initialized = false

export async function initTelemetry(): Promise<void> {
  if (_initialized) return
  if (process.env.OTEL_ENABLED !== 'true') {
    log.info('OpenTelemetry disabled (OTEL_ENABLED != true)')
    return
  }

  try {
    const { NodeSDK }       = await import('@opentelemetry/sdk-node')
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
    const { resourceFromAttributes } = await import('@opentelemetry/resources')
    const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } = await import('@opentelemetry/semantic-conventions')
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node')

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [SEMRESATTRS_SERVICE_NAME]:    'pathelix',
        [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      }),
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-http': { enabled: true },
          '@opentelemetry/instrumentation-express': { enabled: false },
        }),
      ],
    })

    sdk.start()
    _initialized = true
    log.info('OpenTelemetry initialized', { endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })

    process.once('SIGTERM', () => sdk.shutdown().catch((err: unknown) => log.error('OTEL shutdown failed', { err: String(err) })))
  } catch (err) {
    log.warn('OpenTelemetry init failed (packages may be missing)', { err: String(err) })
  }
}

export async function withSpan<T>(
  name:    string,
  attrs:   Record<string, string | number | boolean>,
  fn:      () => Promise<T>,
): Promise<T> {
  if (!_initialized) return fn()

  try {
    const { trace, SpanStatusCode } = await import('@opentelemetry/api')
    const tracer = trace.getTracer('pathelix')

    return await tracer.startActiveSpan(name, async span => {
      for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v)
      try {
        const result = await fn()
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
        throw err
      } finally {
        span.end()
      }
    })
  } catch {
    return fn()
  }
}

export async function spanVrpStep<T>(step: string, tenantId: string, fn: () => Promise<T>): Promise<T> {
  return withSpan(`vrp.${step}`, { 'pathelix.tenant_id': tenantId, 'pathelix.vrp_step': step }, fn)
}

export async function spanDbQuery<T>(table: string, operation: string, fn: () => Promise<T>): Promise<T> {
  return withSpan(`db.${table}.${operation}`, { 'db.table': table, 'db.operation': operation }, fn)
}
