import { readFileSync } from 'node:fs'
import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs/config'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// Derived from the installed package, never hardcoded — used to version the static worker
// files under public/maplibre/<version>/ (see scripts/sync-maplibre-worker.js and
// src/lib/maplibre/config.ts). A future `maplibre-gl` upgrade without re-running the sync
// script fails loudly via the drift test in src/lib/maplibre/__tests__/workerSync.test.ts,
// not silently here.
const maplibreVersion = JSON.parse(
  readFileSync(new URL('./node_modules/maplibre-gl/package.json', import.meta.url), 'utf8'),
).version

// Runtime secrets are not needed to *build*: a Docker image must build without them (they would
// otherwise end up in a build arg / layer). The server validates them at startup anyway
// (instrumentation.ts → validateEnv(), which hard-fails in production).
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build' || process.argv.includes('build')

if (process.env.NODE_ENV !== 'test' && !isBuildPhase) {
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
  // NEXT_DIST_DIR lets a verification build run next to a server already using `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  compress: true,

  env: {
    NEXT_PUBLIC_MAPLIBRE_VERSION: maplibreVersion,
  },

  eslint: { ignoreDuringBuilds: true },

  typescript: { ignoreBuildErrors: false },

  // PDF rendering (@react-pdf/renderer) never runs inside the Next server: its ESM-only reconciler
  // would load a second copy of React (dual package hazard). It runs in src/workers/pdfWorker.ts,
  // reached through src/lib/queue/pdfQueue.ts.
  serverExternalPackages: ['bullmq', 'ioredis', '@prisma/client'],

  experimental: {
    optimizePackageImports: ['@tanstack/react-virtual', '@tanstack/react-query', 'fuse.js', 'zustand', 'zod', 'exceljs', 'dayjs', 'bcryptjs'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000,
  },

  async rewrites() {
    return {
      // Files uploaded before tenant-namespaced storage existed live under public/uploads. They
      // must never be served statically (no auth, cross-tenant readable): this rewrite runs
      // before the filesystem, so /uploads/* always goes through the authenticated files route.
      beforeFiles: [{ source: '/uploads/:path*', destination: '/api/files/legacy/:path*' }],
    }
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
      // camera=(self): the driver app scans bin QR codes in the page (getUserMedia).
      { key: 'Permissions-Policy',     value: 'camera=(self), microphone=(), geolocation=(self)' },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          scriptSrc,
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' data: https://fonts.gstatic.com",
          "img-src 'self' data: blob:",
          "connect-src 'self' https://tiles.openfreemap.org https://api.maptiler.com https://nominatim.openstreetmap.org https://router.project-osrm.org https://api-adresse.data.gouv.fr https://*.ingest.sentry.io https://*.ingest.de.sentry.io",
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
        // Website film, excerpts and poster: stable names, a week in the browser cache.
        source: '/site-media/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }],
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
