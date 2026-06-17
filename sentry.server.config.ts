import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn:              process.env.SENTRY_DSN,
  environment:      process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0,
  enabled:          process.env.NODE_ENV === 'production',
  beforeSend(event) {
    if (event.request?.cookies) delete event.request.cookies
    return event
  },
})
