export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')

    const { validateEnv } = await import('./lib/env')
    validateEnv()

    const { initTelemetry } = await import('./lib/telemetry')
    await initTelemetry()
  }
}

export async function onRequestError(
  err: { digest?: string } & Error,
  request: { path: string; method: string; headers: Record<string, string> },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  const { captureRequestError } = await import('@sentry/nextjs')
  await captureRequestError(err, request, context)
}
