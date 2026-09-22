'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { basemapStyleUrl, hasMapTilerKey, MAP_VIEW_DEFAULTS, OPENFREEMAP_ATTRIBUTION } from '@/lib/maplibre/config'
import { createLogger } from '@/lib/logger'

const log = createLogger('useMapLibreMap')

export interface UseMapLibreMapOptions {
  /** Initial view — [lng, lat], MapLibre/GeoJSON order (NOT Leaflet's [lat, lng]). */
  center:  [number, number]
  zoom:    number
  pitch?:    number
  bearing?:  number
  /** Set false for small/inline maps where the legally-required attribution would be too cramped otherwise kept visible via a compact control. Defaults to true. */
  attribution?: boolean
}

/**
 * Reusable MapLibre lifecycle hook: creates the map once on mount, tears it down on unmount
 * (safe under React 18 StrictMode's mount/cleanup/remount dev cycle — `map.remove()` fully
 * resets the container so a fresh instance can be created right after), keeps it sized to its
 * container via ResizeObserver, and wires the shared default controls/basemap.
 *
 * Only the initial `center`/`zoom`/`pitch`/`bearing` are used — same semantics as the Leaflet
 * `MapContainer` this replaces: later prop changes don't recenter the map, bounds-fitting is
 * each caller's own concern (mirrors the old `BoundsController`/`AutoBounds` pattern).
 */
export function useMapLibreMap(
  containerRef: RefObject<HTMLDivElement | null>,
  options: UseMapLibreMapOptions,
): { map: maplibregl.Map | null; isStyleLoaded: boolean } {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [isStyleLoaded, setIsStyleLoaded] = useState(false)

  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const opts = optionsRef.current
    const instance = new maplibregl.Map({
      container,
      style:    basemapStyleUrl(),
      center:   opts.center,
      zoom:     opts.zoom,
      pitch:    opts.pitch ?? MAP_VIEW_DEFAULTS.pitch,
      bearing:  opts.bearing ?? MAP_VIEW_DEFAULTS.bearing,
      maxPitch: MAP_VIEW_DEFAULTS.maxPitch,
      attributionControl: false,
    })

    if (opts.attribution !== false) {
      instance.addControl(
        new maplibregl.AttributionControl({
          compact:           true,
          customAttribution: hasMapTilerKey() ? undefined : OPENFREEMAP_ATTRIBUTION,
        }),
        'bottom-right',
      )
    }
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    instance.on('load', () => setIsStyleLoaded(true))
    instance.on('error', (e: unknown) => {
      const inner = e && typeof e === 'object' && 'error' in e ? (e as { error?: Error }).error : undefined
      log.warn('MapLibre error', { error: inner?.message })
    })

    const ro = new ResizeObserver(() => instance.resize())
    ro.observe(container)

    mapRef.current = instance
    setMap(instance)

    return () => {
      ro.disconnect()
      instance.remove()
      mapRef.current = null
      setMap(null)
      setIsStyleLoaded(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init/teardown only, see options semantics above
  }, [containerRef])

  return { map, isStyleLoaded }
}
