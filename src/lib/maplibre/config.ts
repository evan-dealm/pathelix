/**
 * Central MapLibre basemap configuration. The only place that decides which vector tile
 * style to use, and the shared defaults every map on the site should start from.
 *
 * Style selection: `NEXT_PUBLIC_MAPTILER_KEY` present → MapTiler vector style; absent →
 * OpenFreeMap Liberty (free, no key, verified reachable — see ARCHITECTURE.md §9).
 * Never demotiles.maplibre.org (too sparse for real use).
 */

const OPENFREEMAP_LIBERTY_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/** `NEXT_PUBLIC_*` so it's readable client-side — maps only ever render in the browser. */
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY

export function basemapStyleUrl(): string {
  if (MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  }
  return OPENFREEMAP_LIBERTY_STYLE_URL
}

export function hasMapTilerKey(): boolean {
  return Boolean(MAPTILER_KEY)
}

/**
 * MapLibre computes its Web Worker script URL from `import.meta.url` inside its own bundled
 * module (`defaultWorkerUrl()` in maplibre-gl's source). Re-bundled through Next.js's webpack,
 * that `import.meta.url` does not resolve to a real `http(s):` URL, so the check
 * `/^https?:/.test(moduleUrl)` fails and the library silently falls back to an EMPTY worker
 * URL — `new Worker("", { type: "module" })`, which resolves against the current document and
 * ends up trying to run the page's own HTML as a worker script. No error is thrown anywhere:
 * the worker exists but never runs real code, so vector tiles are requested internally but
 * never actually fetched/parsed, and the map's `'load'` event never fires — confirmed via
 * direct instrumentation of the Worker constructor, see ARCHITECTURE.md §9
 *. Serving the worker script ourselves as a plain static file sidesteps the
 * bundler-resolution problem entirely — `maplibregl.setWorkerUrl(WORKER_URL)` (called once,
 * before any Map is constructed) takes priority over `defaultWorkerUrl()`.
 *
 * The files are served from a path that embeds the installed `maplibre-gl` version —
 * `public/maplibre/<version>/maplibre-gl-worker.mjs` (+ `.../maplibre-gl-shared.mjs`, which the
 * worker script itself imports via a relative specifier and which must therefore live
 * alongside it) — so a version bump can never silently serve a stale worker built for a
 * different maplibre-gl release. The version is derived from the installed package at build
 * time (`next.config.mjs` reads `node_modules/maplibre-gl/package.json` and injects
 * `NEXT_PUBLIC_MAPLIBRE_VERSION`) — never hardcoded as a literal here. The files themselves are
 * copies of `node_modules/maplibre-gl/dist/*`, kept in sync automatically by
 * `scripts/sync-maplibre-worker.js` (runs on `postinstall`) and committed so a fresh checkout
 * works even before `npm install` reruns that hook (also covers `npm ci --ignore-scripts`,
 * which CI/Docker use — see src/lib/maplibre/__tests__/workerSync.test.ts, which fails loudly
 * if the committed files ever drift from node_modules). Both are exempted from auth in
 * `src/middleware.ts`'s matcher, narrowly scoped to this exact versioned path — see the
 * comment there.
 */
const MAPLIBRE_VERSION = process.env.NEXT_PUBLIC_MAPLIBRE_VERSION
if (!MAPLIBRE_VERSION) {
  throw new Error(
    'NEXT_PUBLIC_MAPLIBRE_VERSION is not set — next.config.mjs should inject it from the ' +
    'installed maplibre-gl package version. Check the `env` block in next.config.mjs.',
  )
}
export const MAPLIBRE_WORKER_URL = `/maplibre/${MAPLIBRE_VERSION}/maplibre-gl-worker.mjs`

/**
 * OpenFreeMap's style doesn't embed source attribution (unlike MapTiler's, which does) — the
 * OSM data credit is a legal requirement, not optional, so it's supplied explicitly here and
 * only used for the no-key path.
 */
export const OPENFREEMAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors · <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>'

/**
 * Shared default view parameters for every map on the site. Pitch/bearing chosen to show off
 * the vector basemap's 3D building extrusion (native to the Liberty style, minzoom 14) without
 * fighting readability at the driver-route zoom levels (~10-14) this app actually uses.
 */
export const MAP_VIEW_DEFAULTS = {
  pitch:    45,
  bearing:  -17,
  maxPitch: 70,
} as const
