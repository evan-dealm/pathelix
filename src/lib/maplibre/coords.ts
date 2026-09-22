/**
 * Coordinate order conversions.
 *
 * The rest of the app (Prisma models, Zod schemas, `TourStep`, `/api/routing` waypoints sent
 * to the server) always stores/passes latitude and longitude as separate `{lat, lng}` fields
 * or as a `[lat, lng]` tuple — the Leaflet convention. MapLibre and GeoJSON both use
 * `[lng, lat]`. Every point crossing into a MapLibre API (source data, `Marker`, `fitBounds`)
 * must go through one of these — never pass a raw `[lat, lng]` tuple to MapLibre directly.
 */

export type LatLng = { lat: number; lng: number }

/** `{lat, lng}` -> MapLibre's `[lng, lat]`. */
export function toLngLat(point: LatLng): [number, number] {
  return [point.lng, point.lat]
}

/** Leaflet-style `[lat, lng]` tuple -> MapLibre's `[lng, lat]`. */
export function latLngTupleToLngLat([lat, lng]: [number, number]): [number, number] {
  return [lng, lat]
}

/**
 * `/api/routing` already returns GeoJSON `[lng, lat]` coordinates (it always has — the old
 * Leaflet code had to flip them with `geoToLeaflet()` before use). For MapLibre they can be
 * used as-is; this identity helper exists only so every call site is explicit about which
 * order its data is already in, instead of some flipping and some not.
 */
export function routingGeometryToLngLat(coords: [number, number][]): [number, number][] {
  return coords
}
