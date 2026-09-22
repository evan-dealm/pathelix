#!/usr/bin/env node
// Keeps public/maplibre/<version>/maplibre-gl-*.mjs in sync with the installed maplibre-gl
// version. Runs on `npm install` (postinstall). See src/lib/maplibre/config.ts
// (MAPLIBRE_WORKER_URL) for why these need to exist as plain static assets at all, and why the
// path is versioned.

const fs = require('fs')
const path = require('path')

// The worker script itself `import`s a second file (maplibre-gl-shared.mjs, the code shared
// between the main thread and worker bundles) via a relative specifier — both must be served
// from the same public directory for that import to resolve.
const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

const pkgDir = path.join(__dirname, '..', 'node_modules', 'maplibre-gl')
const distDir = path.join(pkgDir, 'dist')

if (!fs.existsSync(distDir)) {
  console.warn('[sync-maplibre-worker] maplibre-gl not installed yet, skipping (expected during a fresh `npm install` before dependencies resolve).')
  process.exit(0)
}

const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
const publicDir = path.join(__dirname, '..', 'public', 'maplibre', version)
fs.mkdirSync(publicDir, { recursive: true })

for (const file of FILES) {
  fs.copyFileSync(path.join(distDir, file), path.join(publicDir, file))
  console.log(`[sync-maplibre-worker] Copied ${file} -> public/maplibre/${version}/`)
}

// Stale versioned directories from a prior maplibre-gl version are harmless (never referenced,
// since MAPLIBRE_WORKER_URL is always derived from the currently-installed version) but would
// otherwise accumulate forever across upgrades — remove any that don't match the current one.
const maplibreDir = path.join(__dirname, '..', 'public', 'maplibre')
for (const entry of fs.readdirSync(maplibreDir)) {
  if (entry !== version) {
    fs.rmSync(path.join(maplibreDir, entry), { recursive: true, force: true })
    console.log(`[sync-maplibre-worker] Removed stale public/maplibre/${entry}/`)
  }
}
