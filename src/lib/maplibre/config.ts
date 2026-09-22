/**
 * Central MapLibre basemap configuration. The only place that decides which vector tile
 * style to use, and the shared defaults every map on the site should start from.
 *
 * Style selection: `NEXT_PUBLIC_MAPTILER_KEY` present → MapTiler vector style; absent →
 * OpenFreeMap Liberty (free, no key, verified reachable — see MIGRATION_MAPLIBRE_LOG.md).
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
