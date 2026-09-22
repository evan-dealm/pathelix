'use client'

import React from 'react'
import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'

import { useMapLibreMap } from '@/hooks/useMapLibreMap'
import { toLngLat } from '@/lib/maplibre/coords'
import { escapeHtml } from '@/lib/maplibre/escapeHtml'
import type { Driver, Exutoire } from '@/lib/types'
import { MISSION_TYPE_HEX } from '@/lib/types'
import { useTrade } from '@/providers/TradeProvider'
import type { TourResult } from '@/lib/algorithm'

const DRIVER_COLORS = [
  '#3B82F6', '#22C55E', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
  '#06B6D4', '#84CC16', '#E11D48', '#7C3AED',
  '#0EA5E9', '#D946EF', '#10B981', '#F43F5E',
  '#6366F1', '#FBBF24', '#A3E635', '#FB923C',
  '#2DD4BF', '#818CF8', '#C084FC', '#34D399',
  '#FCA5A5', '#67E8F9', '#FDE047', '#A78BFA',
  '#4ADE80', '#FB7185',
]

const DIMMED_COLOR = '#555555'

function driverColor(idx: number): string {
  return DRIVER_COLORS[idx % DRIVER_COLORS.length]
}

interface GeoLineString {
  type:        'LineString'
  coordinates: [number, number][]
}

export interface DriverLivePosition {
  driverId:  string
  lat:       number
  lng:       number
  speedKmh:  number
  ignition:  boolean
  updatedAt: number
}

export interface FleetMapProps {
  drivers:          Driver[]
  calcResults:      Record<string, TourResult | null>
  exutoires:        Exutoire[]
  hoveredMissionId?: string | null
  selectedDriverId?: string | null
  onSelectDriver?:   (_id: string | null) => void

  livePositions?:    DriverLivePosition[]
}

function effectiveDepot(driver: Driver, exutoires: Exutoire[]): { lat: number; lng: number } {
  if (driver.startingExutoireId) {
    const ex = exutoires.find(e => e.id === driver.startingExutoireId)
    if (ex) return { lat: ex.lat, lng: ex.lng }
  }
  return { lat: driver.depotLat, lng: driver.depotLng }
}

// ─── Layer/source ids ───────────────────────────────────────────────────────────────────────
const ROUTES_SOURCE   = 'fleetmap-routes'
const ROUTES_HALO_LAYER = 'fleetmap-routes-halo'
const ROUTES_LINE_LAYER = 'fleetmap-routes-line'
const MISSIONS_SOURCE   = 'fleetmap-missions'
const MISSIONS_CIRCLE_LAYER = 'fleetmap-missions-circle'
const MISSIONS_LABEL_LAYER  = 'fleetmap-missions-label'
const HEATMAP_LAYER = 'fleetmap-heatmap'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

function makeDivIconEl(html: string, size: number): HTMLDivElement {
  const el = document.createElement('div')
  el.innerHTML = html
  el.style.width  = `${size}px`
  el.style.height = `${size}px`
  return el.firstElementChild as HTMLDivElement
}

function depotIconHtml(color: string, dimmed: boolean): string {
  const c = dimmed ? DIMMED_COLOR : color
  const opacity = dimmed ? 0.35 : 1
  return `<div style="width:30px;height:30px;border-radius:50%;background:${c}22;border:2px solid ${c};display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;opacity:${opacity};cursor:pointer;">🏠</div>`
}

const EXUTOIRE_ICON_HTML = `<div style="width:28px;height:28px;border-radius:6px;background:#22c55e22;border:2px solid #22c55e;display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;">♻️</div>`

function liveIconHtml(color: string, ignition: boolean, stale: boolean): string {
  return `<div style="
    width:28px;height:28px;border-radius:50%;
    background:${stale ? '#9CA3AF' : color};
    border:3px solid white;
    box-shadow:0 2px 8px rgba(0,0,0,0.3);
    display:flex;align-items:center;justify-content:center;
    font-size:14px;
    ${ignition ? '' : 'opacity:0.5;'}
  ">🚛</div>`
}

function tooltipPopup(): maplibregl.Popup {
  return new maplibregl.Popup({
    closeButton: false, closeOnClick: false, offset: 16, className: 'fleetmap-tooltip',
  })
}

function FleetMapInner({
  drivers,
  calcResults,
  exutoires,
  hoveredMissionId,
  livePositions,
}: FleetMapProps) {

  const containerRef = useRef<HTMLDivElement>(null)

  const [showHeatmap, setShowHeatmap] = useState(false)
  const { missionIcon: tradeMissionIcon } = useTrade()

  const [roadGeo, setRoadGeo]           = useState<Record<string, GeoLineString | null>>({})
  const [loadingRoutes, setLoadingRoutes] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const [isolated, setIsolated] = useState<Set<string>>(new Set())
  const toggleIsolate = useCallback((id: string) => {
    setIsolated(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clearIsolation = useCallback(() => setIsolated(new Set()), [])
  const hasIsolation = isolated.size > 0

  const routeStepsKey = useMemo(
    () => drivers.map(d => `${d.id}:${calcResults[d.id]?.steps?.length ?? 0}`).join('|'),
    [drivers, calcResults],
  )

  const driverIndex = useMemo(() => {
    const m = new Map<string, number>()
    drivers.forEach((d, i) => m.set(d.id, i))
    return m
  }, [drivers])

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const hasRoutes = drivers.some(d => (calcResults[d.id]?.steps?.length ?? 0) > 0)
    if (!hasRoutes) { setRoadGeo({}); return }

    setLoadingRoutes(true)

    const timer = setTimeout(() => {
      async function fetchRoute(driver: Driver): Promise<[string, GeoLineString | null]> {
        const res = calcResults[driver.id]
        if (!res || res.steps.length === 0) return [driver.id, null]
        const depot = effectiveDepot(driver, exutoires)
        const wps: [number, number][] = [
          [depot.lng, depot.lat],
          ...res.steps.filter(s => !s.hasMissingCoords && !s.isSynthetic)
            .map(s => [s.mission.longitude, s.mission.latitude] as [number, number]),
          [depot.lng, depot.lat],
        ]
        const capped = wps.length > 25 ? wps.slice(0, 25) : wps
        if (capped.length < 2) return [driver.id, null]
        try {
          const r = await fetch('/api/routing', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ waypoints: capped }), signal: ctrl.signal,
          })
          const geo = r.ok ? ((await r.json()).geometry ?? null) : null
          return [driver.id, geo]
        } catch { return [driver.id, null] }
      }

      Promise.all(drivers.map(fetchRoute)).then(entries => {
        if (!ctrl.signal.aborted) {
          setRoadGeo(Object.fromEntries(entries))
          setLoadingRoutes(false)
        }
      })
    }, 600)

    return () => { clearTimeout(timer); ctrl.abort() }
  }, [routeStepsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const allPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = []
    for (const d of drivers) { const dep = effectiveDepot(d, exutoires); pts.push([dep.lat, dep.lng]) }
    for (const d of drivers) {
      const r = calcResults[d.id]; if (!r) continue
      for (const s of r.steps) if (!s.hasMissingCoords) pts.push([s.mission.latitude, s.mission.longitude])
    }
    for (const e of exutoires) pts.push([e.lat, e.lng])
    return pts
  }, [drivers, calcResults, exutoires])

  const pointsHash = useMemo(() => {
    let h = 2166136261
    for (const [a, b] of allPoints) {
      h ^= (a * 1e5) | 0; h = Math.imul(h, 16777619)
      h ^= (b * 1e5) | 0; h = Math.imul(h, 16777619)
    }
    return (h >>> 0)
  }, [allPoints])

  const routes = useMemo(() => drivers.map(d => {
    const idx = driverIndex.get(d.id) ?? 0
    const color = driverColor(idx)
    const result = calcResults[d.id]
    if (!result || result.steps.length === 0) return { driver: d, color, coords: [] as [number, number][] }
    const depot = effectiveDepot(d, exutoires)
    const coords: [number, number][] = [
      [depot.lat, depot.lng],
      ...result.steps.filter(s => !s.hasMissingCoords).map(s => [s.mission.latitude, s.mission.longitude] as [number, number]),
      [depot.lat, depot.lng],
    ]
    return { driver: d, color, coords }
  }), [drivers, calcResults, driverIndex, exutoires])

  const activeRoutes = useMemo(() => routes.filter(r => r.coords.length > 0), [routes])

  const center: [number, number] = allPoints.length > 0
    ? toLngLat({ lat: allPoints[0][0], lng: allPoints[0][1] })
    : [6.1, 45.9]

  function isDriverDimmed(driverId: string): boolean {
    return hasIsolation && !isolated.has(driverId)
  }

  const { map, isStyleLoaded } = useMapLibreMap(containerRef, { center, zoom: 11 })

  // ─── One-time layer setup, once the style has loaded ────────────────────────────────────
  const layersReadyRef = useRef(false)
  useEffect(() => {
    if (!map || !isStyleLoaded || layersReadyRef.current) return
    layersReadyRef.current = true

    map.addSource(ROUTES_SOURCE, { type: 'geojson', data: EMPTY_FC })
    map.addLayer({
      id: ROUTES_HALO_LAYER, type: 'line', source: ROUTES_SOURCE,
      filter: ['==', ['get', 'isolated'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 10, 'line-opacity': 0.2 },
    })
    map.addLayer({
      id: ROUTES_LINE_LAYER, type: 'line', source: ROUTES_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color':   ['get', 'lineColor'],
        'line-width':   ['get', 'lineWidth'],
        'line-opacity': ['get', 'lineOpacity'],
        'line-dasharray': ['case', ['get', 'dashed'], ['literal', [2, 1.3]], ['literal', [1, 0]]],
      },
    })

    map.addSource(MISSIONS_SOURCE, { type: 'geojson', data: EMPTY_FC })
    map.addLayer({
      id: HEATMAP_LAYER, type: 'heatmap', source: MISSIONS_SOURCE,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight':    1,
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 1, 15, 3],
        'heatmap-radius':    ['interpolate', ['linear'], ['zoom'], 9, 18, 15, 40],
        'heatmap-opacity':   0.55,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0,    'rgba(0,0,0,0)',
          0.2,  '#2DD4BF',
          0.4,  '#22C55E',
          0.6,  '#F59E0B',
          0.8,  '#EF4444',
          1,    '#DC2626',
        ],
      },
    })
    map.addLayer({
      id: MISSIONS_CIRCLE_LAYER, type: 'circle', source: MISSIONS_SOURCE,
      paint: {
        'circle-radius': [
          'case', ['boolean', ['feature-state', 'hovered'], false], 17, 12,
        ],
        'circle-color':        ['get', 'color'],
        'circle-opacity':      ['get', 'fillOpacity'],
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': [
          'case', ['boolean', ['feature-state', 'hovered'], false], 3, 2,
        ],
        'circle-stroke-opacity': ['get', 'strokeOpacity'],
      },
    })
    map.addLayer({
      id: MISSIONS_LABEL_LAYER, type: 'symbol', source: MISSIONS_SOURCE,
      layout: {
        'text-field': ['get', 'emoji'],
        'text-size': [
          'case', ['boolean', ['feature-state', 'hovered'], false], 16, 11,
        ],
        'text-allow-overlap': true, 'text-ignore-placement': true,
      },
      paint: { 'text-opacity': ['get', 'fillOpacity'] },
    })

    const tooltip = tooltipPopup()
    let hoveredFeatureId: number | string | undefined

    function setHover(id: number | string | undefined) {
      if (hoveredFeatureId === id) return
      if (hoveredFeatureId !== undefined) {
        map!.setFeatureState({ source: MISSIONS_SOURCE, id: hoveredFeatureId }, { hovered: false })
      }
      hoveredFeatureId = id
      if (id !== undefined) {
        map!.setFeatureState({ source: MISSIONS_SOURCE, id }, { hovered: true })
      }
    }

    map.on('mousemove', MISSIONS_CIRCLE_LAYER, (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      setHover(f.id)
      map!.getCanvas().style.cursor = 'pointer'
      const p = f.properties as Record<string, string>
      tooltip.setLngLat((f.geometry as Point).coordinates as [number, number]).setHTML(`
        <div style="font-size:12px;line-height:1.4">
          <div style="font-weight:600;color:${p.color}">${escapeHtml(p.emoji)} ${escapeHtml(p.label)}</div>
          <div style="color:#94a3b8">${escapeHtml(p.timeRange)}</div>
          <div style="color:${p.driverColor};opacity:.8">${escapeHtml(p.driverName)}</div>
        </div>
      `).addTo(map!)
    })
    map.on('mouseleave', MISSIONS_CIRCLE_LAYER, () => {
      setHover(undefined)
      map!.getCanvas().style.cursor = ''
      tooltip.remove()
    })
    map.on('click', MISSIONS_CIRCLE_LAYER, (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      const driverId = (f?.properties as Record<string, string> | undefined)?.driverId
      if (driverId) toggleIsolate(driverId)
    })
    map.on('click', ROUTES_LINE_LAYER, (e: maplibregl.MapLayerMouseEvent) => {
      const driverId = (e.features?.[0]?.properties as Record<string, string> | undefined)?.driverId
      if (driverId) toggleIsolate(driverId)
    })
    map.on('mouseenter', ROUTES_LINE_LAYER, () => { map!.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', ROUTES_LINE_LAYER, () => { map!.getCanvas().style.cursor = '' })
  }, [map, isStyleLoaded, toggleIsolate])

  // ─── Routes source data ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !isStyleLoaded || !layersReadyRef.current) return
    const source = map.getSource(ROUTES_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (!source) return

    const features: Feature<LineString>[] = []
    for (const { driver, color, coords } of routes) {
      if (coords.length < 2) continue
      const geo = roadGeo[driver.id]
      const positions = geo?.coordinates?.length ? geo.coordinates : coords.map(([lat, lng]) => [lng, lat])
      const lngLatCoords: [number, number][] = geo?.coordinates?.length
        ? positions as [number, number][]
        : coords.map(([lat, lng]) => toLngLat({ lat, lng }))

      const dimmed = isDriverDimmed(driver.id)
      const iso = isolated.has(driver.id)
      features.push({
        type: 'Feature',
        id: driverIndex.get(driver.id) ?? 0,
        geometry: { type: 'LineString', coordinates: lngLatCoords },
        properties: {
          driverId: driver.id,
          color,
          isolated: iso,
          lineColor: dimmed ? DIMMED_COLOR : color,
          lineWidth: iso ? 5 : (dimmed ? 2 : (loadingRoutes ? 2 : 4)),
          lineOpacity: iso ? 1 : (dimmed ? 0.15 : (loadingRoutes ? 0.4 : 0.85)),
          dashed: loadingRoutes && !iso && !dimmed,
        },
      })
    }
    source.setData({ type: 'FeatureCollection', features })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isStyleLoaded, routes, roadGeo, isolated, loadingRoutes, hasIsolation])

  // ─── Mission points source data (also feeds the heatmap layer) ─────────────────────────────
  const missionIdToFeatureId = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    if (!map || !isStyleLoaded || !layersReadyRef.current) return
    const source = map.getSource(MISSIONS_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (!source) return

    const MAX_MAP_MARKERS = 500
    const features: Feature<Point>[] = []
    const idMap = new Map<string, number>()
    let fid = 0

    outer:
    for (const driver of drivers) {
      const result = calcResults[driver.id]
      if (!result) continue
      const idx = driverIndex.get(driver.id) ?? 0
      const color = driverColor(idx)
      const dimmed = isDriverDimmed(driver.id)
      for (const step of result.steps) {
        if (step.hasMissingCoords || step.isSynthetic) continue
        const pm = step.mission
        const typeColor = (MISSION_TYPE_HEX as Record<string, string>)[pm.type] ?? '#6b7280'
        const emoji = tradeMissionIcon(pm.type) || '📍'
        idMap.set(pm.id, fid)
        features.push({
          type: 'Feature',
          id: fid++,
          geometry: { type: 'Point', coordinates: toLngLat({ lat: pm.latitude, lng: pm.longitude }) },
          properties: {
            missionId:    pm.id,
            driverId:     driver.id,
            color:        dimmed ? DIMMED_COLOR : typeColor,
            emoji,
            label:        pm.clientName || pm.outletName || pm.address,
            timeRange:    `${step.arrivalStr} → ${step.departureStr}`,
            driverColor:  dimmed ? DIMMED_COLOR : color,
            driverName:   `${driver.firstName} ${driver.lastName}`,
            fillOpacity:  dimmed ? 0.25 : 1,
            strokeOpacity: dimmed ? 0.25 : 1,
          },
        })
        if (features.length >= MAX_MAP_MARKERS) break outer
      }
    }
    missionIdToFeatureId.current = idMap
    source.setData({ type: 'FeatureCollection', features })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isStyleLoaded, drivers, calcResults, driverIndex, isolated, hasIsolation, tradeMissionIcon])

  // ─── Heatmap visibility toggle ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !isStyleLoaded || !layersReadyRef.current) return
    map.setLayoutProperty(HEATMAP_LAYER, 'visibility', showHeatmap ? 'visible' : 'none')
  }, [map, isStyleLoaded, showHeatmap])

  // ─── External hover sync (e.g. hovering a mission in a list elsewhere in the UI) ────────────
  const externalHoverIdRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!map || !isStyleLoaded || !layersReadyRef.current) return
    const prev = externalHoverIdRef.current
    if (prev !== undefined) {
      map.setFeatureState({ source: MISSIONS_SOURCE, id: prev }, { hovered: false })
      externalHoverIdRef.current = undefined
    }
    if (hoveredMissionId) {
      const fid = missionIdToFeatureId.current.get(hoveredMissionId)
      if (fid !== undefined) {
        map.setFeatureState({ source: MISSIONS_SOURCE, id: fid }, { hovered: true })
        externalHoverIdRef.current = fid
      }
    }
  }, [map, isStyleLoaded, hoveredMissionId])

  // ─── fitBounds on data change ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !isStyleLoaded || allPoints.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    for (const [lat, lng] of allPoints) bounds.extend(toLngLat({ lat, lng }))
    try { map.fitBounds(bounds, { padding: 40 }) } catch { /* single/invalid point */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isStyleLoaded, pointsHash])

  // ─── Depot markers (HTML Marker + hover tooltip) ────────────────────────────────────────
  const depotMarkersRef = useRef<Map<string, { marker: maplibregl.Marker; popup: maplibregl.Popup }>>(new Map())
  useEffect(() => {
    if (!map || !isStyleLoaded) return
    const held = depotMarkersRef.current
    const seen = new Set<string>()

    for (const { driver, color } of routes) {
      seen.add(driver.id)
      const dep = effectiveDepot(driver, exutoires)
      const dimmed = isDriverDimmed(driver.id)
      const depotName = driver.startingExutoireId
        ? exutoires.find(e => e.id === driver.startingExutoireId)?.name ?? driver.depotName
        : driver.depotName

      let entry = held.get(driver.id)
      if (!entry) {
        const el = makeDivIconEl(depotIconHtml(color, dimmed), 30)
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(toLngLat({ lat: dep.lat, lng: dep.lng }))
          .addTo(map)
        const popup = tooltipPopup()
        el.addEventListener('mouseenter', () => {
          popup.setLngLat(toLngLat({ lat: dep.lat, lng: dep.lng }))
            .setHTML(`<div style="font-size:12px"><div style="font-weight:600">${escapeHtml(driver.firstName)} ${escapeHtml(driver.lastName)}</div><div style="color:#94a3b8">${escapeHtml(depotName)}</div></div>`)
            .addTo(map)
        })
        el.addEventListener('mouseleave', () => popup.remove())
        el.addEventListener('click', ev => { ev.stopPropagation(); toggleIsolate(driver.id) })
        entry = { marker, popup }
        held.set(driver.id, entry)
      } else {
        entry.marker.setLngLat(toLngLat({ lat: dep.lat, lng: dep.lng }))
        entry.marker.getElement().replaceChildren(makeDivIconEl(depotIconHtml(color, dimmed), 30))
      }
    }
    for (const [id, entry] of held) {
      if (!seen.has(id)) { entry.marker.remove(); entry.popup.remove(); held.delete(id) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isStyleLoaded, routes, exutoires, isolated, hasIsolation, toggleIsolate])

  // ─── Exutoire markers (static-ish, small count) ─────────────────────────────────────────
  const exutoireMarkersRef = useRef<Map<string, { marker: maplibregl.Marker; popup: maplibregl.Popup }>>(new Map())
  useEffect(() => {
    if (!map || !isStyleLoaded) return
    const held = exutoireMarkersRef.current
    const seen = new Set<string>()

    for (const e of exutoires) {
      seen.add(e.id)
      if (held.has(e.id)) continue
      const el = makeDivIconEl(EXUTOIRE_ICON_HTML, 28)
      const marker = new maplibregl.Marker({ element: el }).setLngLat(toLngLat({ lat: e.lat, lng: e.lng })).addTo(map)
      const popup = tooltipPopup()
      el.addEventListener('mouseenter', () => {
        popup.setLngLat(toLngLat({ lat: e.lat, lng: e.lng }))
          .setHTML(`<div style="font-size:12px"><div style="font-weight:600;color:#4ade80">${escapeHtml(e.name)}</div><div style="color:#94a3b8">${escapeHtml(e.address)}</div></div>`)
          .addTo(map)
      })
      el.addEventListener('mouseleave', () => popup.remove())
      held.set(e.id, { marker, popup })
    }
    for (const [id, entry] of held) {
      if (!seen.has(id)) { entry.marker.remove(); entry.popup.remove(); held.delete(id) }
    }
  }, [map, isStyleLoaded, exutoires])

  // ─── Live position markers ───────────────────────────────────────────────────────────────
  const liveMarkersRef = useRef<Map<string, { marker: maplibregl.Marker; popup: maplibregl.Popup }>>(new Map())
  useEffect(() => {
    if (!map || !isStyleLoaded) return
    const held = liveMarkersRef.current
    const seen = new Set<string>()

    for (const pos of livePositions ?? []) {
      const driverIdx = drivers.findIndex(d => d.id === pos.driverId)
      const driver = drivers[driverIdx]
      if (!driver) continue
      seen.add(pos.driverId)
      const color = driverColor(driverIdx)
      const ageMin = Math.round((Date.now() - pos.updatedAt) / 60_000)
      const isStale = ageMin > 30
      const ageLabel = ageMin < 1 ? "A l'instant" : ageMin < 60 ? `Il y a ${ageMin} min` : `Il y a ${Math.round(ageMin / 60)}h`
      const html = `<div style="font-size:12px">
          <div style="font-weight:600;color:${color}">${escapeHtml(driver.firstName)} ${escapeHtml(driver.lastName)}</div>
          <div style="color:#6b7280">${pos.speedKmh > 0 ? `${Math.round(pos.speedKmh)} km/h` : "A l'arret"}</div>
          <div style="color:#94a3b8">${ageLabel}</div>
          ${!pos.ignition ? '<div style="color:#f87171">Moteur eteint</div>' : ''}
        </div>`

      const entry = held.get(pos.driverId)
      if (!entry) {
        const el = makeDivIconEl(liveIconHtml(color, pos.ignition, isStale), 28)
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(toLngLat({ lat: pos.lat, lng: pos.lng }))
          .addTo(map)
        const popup = tooltipPopup()
        el.addEventListener('mouseenter', () => popup.setLngLat(toLngLat({ lat: pos.lat, lng: pos.lng })).setHTML(html).addTo(map))
        el.addEventListener('mouseleave', () => popup.remove())
        held.set(pos.driverId, { marker, popup })
      } else {
        entry.marker.setLngLat(toLngLat({ lat: pos.lat, lng: pos.lng }))
        entry.marker.getElement().replaceChildren(makeDivIconEl(liveIconHtml(color, pos.ignition, isStale), 28))
      }
    }
    for (const [id, entry] of held) {
      if (!seen.has(id)) { entry.marker.remove(); entry.popup.remove(); held.delete(id) }
    }
  }, [map, isStyleLoaded, livePositions, drivers])

  return (
    <div className="relative w-full h-full" role="application" aria-label="Carte de la flotte">
      {!isStyleLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#09090f] text-gray-600 text-sm z-10 pointer-events-none">
          Chargement carte…
        </div>
      )}

      {isStyleLoaded && allPoints.length === 0 && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center bg-gray-950 text-gray-600 gap-2 pointer-events-none">
          <div className="text-3xl">🗺️</div>
          <div className="text-sm">Aucune donnee geographique</div>
        </div>
      )}

      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#09090f' }} />

      <div className="absolute top-3 right-28 z-[999] flex items-center gap-2">
        <button
          onClick={() => setShowHeatmap(v => !v)}
          title={showHeatmap ? 'Masquer la heatmap' : 'Afficher la densité de missions'}
          className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-[10px] font-semibold transition-colors cursor-pointer ${
            showHeatmap
              ? 'bg-orange-900/80 border-orange-600 text-orange-200 hover:border-orange-400'
              : 'bg-gray-950/90 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'
          }`}
        >
          🌡 Densité
        </button>
        {hasIsolation && (
          <button
            onClick={clearIsolation}
            className="flex items-center gap-1.5 bg-gray-950/90 border border-gray-700 hover:border-gray-500 rounded-lg px-3 py-1.5 text-gray-300 hover:text-white transition-colors cursor-pointer"
            title="Tout afficher"
          >
            <span className="text-[10px]">{isolated.size} isole{isolated.size > 1 ? 's' : ''}</span>
            <span className="text-xs font-bold">✕</span>
          </button>
        )}
      </div>

      {loadingRoutes && (
        <div className={`absolute ${hasIsolation ? 'top-12' : 'top-3'} right-3 z-[999] flex items-center gap-2 bg-gray-950/90 border border-gray-800 rounded-lg px-3 py-1.5 pointer-events-none`}>
          <svg className="w-3.5 h-3.5 animate-spin text-[#0055A4]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span className="text-[10px] text-gray-400">Traces routiers...</span>
        </div>
      )}

      {activeRoutes.length > 0 && (
        <div className="absolute bottom-4 left-3 z-[999] bg-gray-950/90 border border-gray-800 rounded-lg px-3 py-2.5 space-y-0.5 max-w-[190px] max-h-[45vh] overflow-y-auto"
             style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>{activeRoutes.length} tournees</span>
            {hasIsolation && (
              <button
                onClick={(e) => { e.stopPropagation(); clearIsolation() }}
                className="text-[8px] text-gray-500 hover:text-gray-300 transition-colors px-1"
              >tout afficher</button>
            )}
          </div>
          {activeRoutes.map(({ driver, color }) => {
            const isIso = isolated.has(driver.id)
            const dimmed = hasIsolation && !isIso
            return (
              <div
                key={driver.id}
                className={`flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 transition-colors
                  ${isIso ? 'bg-white/10' : 'hover:bg-white/5'}`}
                onClick={(e) => { e.stopPropagation(); toggleIsolate(driver.id) }}
              >
                <div style={{
                  width: 14, height: 3, borderRadius: 2, flexShrink: 0,
                  background: dimmed ? DIMMED_COLOR : color,
                  opacity: dimmed ? 0.4 : 1,
                }} />
                <span className={`text-[10px] truncate transition-colors ${dimmed ? 'text-gray-600' : 'text-gray-300'}`}>
                  {driver.firstName} {driver.lastName}
                </span>
                {isIso && <span className="text-[8px] text-gray-500 ml-auto">✕</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const FleetMap = React.memo(FleetMapInner)
export default FleetMap
