'use client'

import { useEffect, useMemo, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useMapLibreMap } from '@/hooks/useMapLibreMap'
import { toLngLat } from '@/lib/maplibre/coords'
import { escapeHtml } from '@/lib/maplibre/escapeHtml'

const DRIVER_COLORS = [
  '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#06B6D4', '#84CC16',
]

function truckMarkerElement(color: string, ignition: boolean): HTMLDivElement {
  const el = document.createElement('div')
  el.style.width        = '32px'
  el.style.height       = '32px'
  el.style.borderRadius = '50%'
  el.style.background   = `${color}22`
  el.style.border       = `2px solid ${color}`
  el.style.display      = 'flex'
  el.style.alignItems   = 'center'
  el.style.justifyContent = 'center'
  el.style.fontSize     = '16px'
  el.style.opacity      = ignition ? '1' : '0.6'
  if (ignition) el.style.animation = 'pulse 1.5s infinite'
  el.textContent = '🚛'
  return el
}

interface LivePosition {
  driverId:  string
  lat:       number
  lng:       number
  speedKmh:  number
  ignition:  boolean
  updatedAt: number
}

interface Driver {
  id:        string
  firstName: string
  lastName:  string
}

interface Props {
  positions: LivePosition[]
  drivers:   Driver[]
  height?:   string
}

export function LiveTrackingMap({ positions, drivers, height = '300px' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef    = useRef<Map<string, maplibregl.Marker>>(new Map())
  const hasFitRef      = useRef(false)

  const driverMap = useMemo(() => new Map(drivers.map((d, i) => [d.id, { ...d, colorIdx: i }])), [drivers])

  const activePositions = useMemo(
    () => positions.filter(p => (Date.now() - p.updatedAt) < 30 * 60_000),
    [positions],
  )

  const defaultCenter: [number, number] = activePositions.length > 0
    ? toLngLat({ lat: activePositions[0].lat, lng: activePositions[0].lng })
    : [2.3, 46.8] // France, [lng, lat]

  const { map, isStyleLoaded } = useMapLibreMap(containerRef, {
    center: defaultCenter,
    zoom:   10,
  })

  // Sync markers to current positions — MapLibre markers aren't declarative, so each render
  // diffs against the previous marker set instead of re-adding everything.
  useEffect(() => {
    if (!map || !isStyleLoaded) return

    const markers = markersRef.current
    const seen = new Set<string>()

    for (const pos of activePositions) {
      seen.add(pos.driverId)
      const d = driverMap.get(pos.driverId)
      const color = DRIVER_COLORS[(d?.colorIdx ?? 0) % DRIVER_COLORS.length]
      const secAgo = Math.round((Date.now() - pos.updatedAt) / 1000)
      const timeAgo = secAgo < 60 ? `${secAgo}s` : `${Math.round(secAgo / 60)}min`

      const driverLabel = d ? `${escapeHtml(d.firstName)} ${escapeHtml(d.lastName)}` : escapeHtml(pos.driverId)
      const popupHtml = `
        <div style="min-width:160px;font-family:sans-serif">
          <div style="font-weight:700;margin-bottom:4px">${driverLabel}</div>
          <div style="font-size:12px;color:#64748b">
            ${Math.round(pos.speedKmh)} km/h${pos.ignition ? ' · Moteur ON' : ' · Arrêté'}
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">Mis à jour il y a ${timeAgo}</div>
        </div>
      `

      let marker = markers.get(pos.driverId)
      if (!marker) {
        marker = new maplibregl.Marker({ element: truckMarkerElement(color, pos.ignition) })
          .setLngLat(toLngLat({ lat: pos.lat, lng: pos.lng }))
          .setPopup(new maplibregl.Popup({ offset: 20 }).setHTML(popupHtml))
          .addTo(map)
        markers.set(pos.driverId, marker)
      } else {
        marker.setLngLat(toLngLat({ lat: pos.lat, lng: pos.lng }))
        marker.getPopup()?.setHTML(popupHtml)
        marker.getElement().replaceWith(truckMarkerElement(color, pos.ignition))
      }
    }

    for (const [driverId, marker] of markers) {
      if (!seen.has(driverId)) {
        marker.remove()
        markers.delete(driverId)
      }
    }
  }, [map, isStyleLoaded, activePositions, driverMap])

  // Fit bounds once when positions first become available (mirrors the old AutoBounds: only
  // re-fits when the number of active positions changes, not on every position update).
  useEffect(() => {
    if (!map || !isStyleLoaded || activePositions.length === 0) return
    if (hasFitRef.current && activePositions.length === markersRef.current.size) return

    const bounds = new maplibregl.LngLatBounds()
    for (const p of activePositions) bounds.extend(toLngLat({ lat: p.lat, lng: p.lng }))
    try {
      map.fitBounds(bounds, { padding: 40, maxZoom: 14 })
      hasFitRef.current = true
    } catch { /* invalid bounds (e.g. single identical point) — keep current view */ }
  }, [map, isStyleLoaded, activePositions])

  return <div ref={containerRef} style={{ height, width: '100%', borderRadius: '12px' }} />
}
