import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

if (process.env.NODE_ENV !== 'test') {
  const missing = ['DATABASE_URL', 'SESSION_SECRET'].filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`)
    console.error('Set these in .env.local (dev) or your deployment config (prod)')
    if (process.env.NODE_ENV === 'production') process.exit(1)
  }
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
    console.error('[FATAL] SESSION_SECRET must be at least 32 characters')
    if (process.env.NODE_ENV === 'production') process.exit(1)
  }
}

const isDev = process.env.NODE_ENV !== 'production'

const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'"

const nextConfig = {
  output: 'standalone',
  compress: true,

  eslint: { ignoreDuringBuilds: true },

  typescript: { ignoreBuildErrors: false },

  // NOTE: @react-pdf/renderer PDF generation (/api/tours/pdf, /api/reports/pdf) is BROKEN in
  // production ("next start") — always 500s with React error #31. Root cause: @react-pdf/reconciler
  // ships pure ESM ("type":"module"), so Next auto-externalizes it; the native ESM loader then pulls
  // its own copy of React, separate from the webpack-bundled React the route handler uses to build
  // JSX. Elements built by one React copy fail isValidElement in the reconciler's copy. Adding
  // '@react-pdf/renderer' to serverExternalPackages here does NOT fix this (tried, verified live —
  // identical error/stack before and after). Adding 'react'/'react-dom' here breaks the build
  // entirely (Next's own RSC cache() APIs need its bundled React). This needs either an upstream fix,
  // pinning to a CJS-compatible react-pdf version, or moving PDF rendering out of the Next server
  // process (own worker, mirroring src/workers/vrpWorker.ts) — not a config-flag fix. See git history
  // for the false-start diagnosis this replaces.
  serverExternalPackages: ['bullmq', 'ioredis', '@prisma/client'],

  experimental: {
    optimizePackageImports: ['@tanstack/react-virtual', '@tanstack/react-query', 'fuse.js', 'zustand', 'zod', 'exceljs', 'react-leaflet', 'dayjs', 'bcryptjs'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000,
  },

  webpack(config) {
    config.resolve.alias['pg-native'] = false
    return config
  },

  async headers() {

    const hstsEnabled = process.env.FORCE_HTTPS !== 'false'

    const securityHeaders = [
      { key: 'X-Frame-Options',        value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-XSS-Protection',       value: '1; mode=block' },
      { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy',     value: 'camera=(), microphone=(), geolocation=(self)' },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          scriptSrc,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' data: https://fonts.gstatic.com",
          "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org",
          "connect-src 'self' https://nominatim.openstreetmap.org https://router.project-osrm.org https://*.basemaps.cartocdn.com https://api-adresse.data.gouv.fr https://*.ingest.sentry.io https://*.ingest.de.sentry.io",
          "worker-src 'self' blob:",
          "frame-src 'self' https://www.openstreetmap.org",
          "frame-ancestors 'none'",
        ].join('; '),
      },
    ]

    if (hstsEnabled) {
      securityHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      })
    }

    return [
      { source: '/(.*)', headers: securityHeaders },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

export default withSentryConfig(withNextIntl(nextConfig), {
  silent:         true,
  hideSourceMaps: true,
  webpack: {
    autoInstrumentServerFunctions: false,
    treeshake: { removeDebugLogging: true },
  },
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayIframe:    true,
    excludeReplayShadowDom: true,
    excludeReplayWorker:    true,
  },
})
