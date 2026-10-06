import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

// Guards against the committed public/maplibre/<version>/ worker files drifting from the
// installed maplibre-gl package — e.g. someone bumps the maplibre-gl dependency but forgets to
// rerun the postinstall sync script (or runs `npm ci --ignore-scripts`, which skips postinstall
// entirely — see ARCHITECTURE.md §9 on why the committed
// files must be self-sufficient without that hook ever running).
const ROOT = path.join(__dirname, '..', '..', '..', '..')
const { version } = JSON.parse(
  readFileSync(path.join(ROOT, 'node_modules', 'maplibre-gl', 'package.json'), 'utf8'),
)

const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

describe('public/maplibre/<version> worker files', () => {
  it.each(FILES)('%s matches the installed maplibre-gl package byte-for-byte', (file) => {
    const publicPath = path.join(ROOT, 'public', 'maplibre', version, file)
    const distPath    = path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist', file)

    expect(
      existsSync(publicPath),
      `public/maplibre/${version}/${file} is missing. Run: node scripts/sync-maplibre-worker.js`,
    ).toBe(true)

    expect(
      sha256(publicPath),
      `public/maplibre/${version}/${file} has drifted from node_modules/maplibre-gl/dist/${file} ` +
      `(installed maplibre-gl version: ${version}). Run: node scripts/sync-maplibre-worker.js`,
    ).toBe(sha256(distPath))
  })
})
