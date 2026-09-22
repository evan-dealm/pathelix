#!/usr/bin/env node
// Keeps public/maplibre-gl-worker.mjs in sync with the installed maplibre-gl version.
// Runs on `npm install` (postinstall). See src/lib/maplibre/config.ts (MAPLIBRE_WORKER_URL)
// for why this file needs to exist as a plain static asset at all.

const fs = require('fs')
const path = require('path')

// The worker script itself `import`s a second file (maplibre-gl-shared.mjs, the code shared
// between the main thread and worker bundles) via a relative specifier — both must be served
// from the same public directory for that import to resolve.
const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

const distDir = path.join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist')
const publicDir = path.join(__dirname, '..', 'public')

if (!fs.existsSync(distDir)) {
  console.warn('[sync-maplibre-worker] maplibre-gl not installed yet, skipping (expected during a fresh `npm install` before dependencies resolve).')
  process.exit(0)
}

for (const file of FILES) {
  fs.copyFileSync(path.join(distDir, file), path.join(publicDir, file))
  console.log(`[sync-maplibre-worker] Copied ${file}`)
}
