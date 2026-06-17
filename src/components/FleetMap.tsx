'use client'

import React from 'react'
import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Tooltip, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type { Driver, Exutoire } from '@/lib/types'
import { MISSION_TYPE_HEX } from '@/lib/types'
import { useTrade } from '@/providers/TradeProvider'
import type { TourResult } from '@/lib/algorithm'

type LeafletMapInternal = {
  _initContainer(_id: HTMLElement | string): void
  __reactStrictPatch?: boolean
};

(function patchLeafletStrictMode() {
  const proto = L.Map.prototype as unknown as LeafletMapInternal
  if (proto.__reactStrictPatch) return
  const original = proto._initContainer
  proto._initContainer = function(this: L.Map, id: HTMLElement | string) {
    const el = (typeof id === 'string' ? document.getElementById(id) : id) as Record<string, unknown> | null
    if (el) delete el._leaflet_id
    original.call(this, id)
  }
  proto.__reactStrictPatch = true
}())

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

function geoToLeaflet(coords: [number, number][]): [number, number][] {
  return coords.map(([lng, lat]) => [lat, lng])
}

function effectiveDepot(driver: Driver, exutoires: Exutoire[]): { lat: number; lng: number } {
  if (driver.startingExutoireId) {
    const ex = exutoires.find(e => e.id === driver.startingExutoireId)
    if (ex) return { lat: ex.lat, lng: ex.lng }
  }
  return { lat: driver.depotLat, lng: driver.depotLng }
}

function BoundsController({ points }: { points: [number, number][] }) {
  const map = useMap()

  const pointsHash = useMemo(() => {
    let h = 2166136261
    for (const [a, b] of points) {
      h ^= (a * 1e5) | 0; h = Math.imul(h, 16777619)
      h ^= (b * 1e5) | 0; h = Math.imul(h, 16777619)
    }
    return (h >>> 0)
  }, [points])
  useEffect(() => {
    if (points.length === 0) return
    try { map.fitBounds(L.latLngBounds(points), { padding: [40, 40] }) } catch {  }
  }, [pointsHash, map, points])
  return null
}

function MapClickHandler({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({ click: () => onDeselect() })
  return null
}

function InvalidateSizeOnMount() {
  const map = useMap()
  useEffect(() => {

    const container = map.getContainer()
    let rafId: number
    const ro = new ResizeObserver(() => {
      rafId = requestAnimationFrame(() => {
        try { map.invalidateSize({ animate: false }) } catch {  }
      })
    })
    ro.observe(container)
    return () => { ro.disconnect(); cancelAnimationFrame(rafId) }
  }, [map])
  return null
}

const _iconCache = new Map<string, L.DivIcon>()

function depotIcon(color: string, dimmed: boolean) {
  const key = `depot-${color}-${dimmed}`
  let icon = _iconCache.get(key)
  if (icon) return icon
  const c = dimmed ? DIMMED_COLOR : color
  const opacity = dimmed ? 0.35 : 1
  icon = L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${c}22;border:2px solid ${c};display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;opacity:${opacity};">🏠</div>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  })
  _iconCache.set(key, icon)
  return icon
}

function missionIcon(typeColor: string, emoji: string, hovered: boolean, dimmed: boolean) {
  const key = `mission-${typeColor}-${emoji}-${hovered}-${dimmed}`
  let icon = _iconCache.get(key)
  if (icon) return icon
  const sz = hovered ? 34 : 24
  const bw = hovered ? 3 : 2
  const c = dimmed ? DIMMED_COLOR : typeColor
  const opacity = dimmed ? 0.25 : 1
  icon = L.divIcon({
    className: '',
    html: `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${c}33;border:${bw}px solid ${c};display:flex;align-items:center;justify-content:center;font-size:${hovered ? 16 : 11}px;line-height:1;opacity:${opacity};">${emoji}</div>`,
    iconSize: [sz, sz], iconAnchor: [sz >> 1, sz >> 1],
  })
  _iconCache.set(key, icon)
  return icon
}

const _exutoireIconCached = L.divIcon({
  className: '',
  html: `<div style="width:28px;height:28px;border-radius:6px;background:#22c55e22;border:2px solid #22c55e;display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;">♻️</div>`,
  iconSize: [28, 28], iconAnchor: [14, 14],
})

function exutoireIcon() {
  return _exutoireIconCached
}

function FleetMapInner({
  drivers,
  calcResults,
  exutoires,
  hoveredMissionId,
  livePositions,
}: FleetMapProps) {

  const mapRef      = useRef<L.Map | null>(null)
  const mapWrapperRef = useRef<HTMLDivElement>(null)

  const [showHeatmap, setShowHeatmap] = useState(false)

  const heatCells = useMemo(() => {
    if (!showHeatmap) return []
    const GRID = 0.04
    const cellMap = new Map<string, { lat: number; lng: number; count: number }>()
    for (const driver of drivers) {
      const result = calcResults[driver.id]
      if (!result) continue
      for (const step of result.steps) {
        if (step.isSynthetic || step.hasMissingCoords) continue
        const lat = Math.round(step.mission.latitude / GRID) * GRID
        const lng = Math.round(step.mission.longitude / GRID) * GRID
        const key = `${lat.toFixed(3)},${lng.toFixed(3)}`
        const existing = cellMap.get(key)
        if (existing) existing.count++
        else cellMap.set(key, { lat, lng, count: 1 })
      }
    }
    const cells = Array.from(cellMap.values())
    const maxCount = Math.max(1, ...cells.map(c => c.count))
    return cells.map(c => ({ ...c, intensity: c.count / maxCount }))
  }, [showHeatmap, drivers, calcResults])

  const { missionIcon: tradeMissionIcon } = useTrade()

  const [roadGeo, setRoadGeo]           = useState<Record<string, GeoLineString | null>>({})
  const [loadingRoutes, setLoadingRoutes] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const [mapKey, setMapKey] = useState(0)
  useEffect(() => {
    setMapKey(k => k + 1)
  }, [])

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

  const center: [number, number] = allPoints.length > 0 ? allPoints[0] : [45.9, 6.1]

  function isDriverDimmed(driverId: string): boolean {
    return hasIsolation && !isolated.has(driverId)
  }

  function polylineProps(driverId: string, color: string) {
    const dimmed = isDriverDimmed(driverId)
    return {
      color:   dimmed ? DIMMED_COLOR : color,
      weight:  dimmed ? 2 : 4,
      opacity: dimmed ? 0.15 : 0.85,
    }
  }

  function handleDriverClick(e: L.LeafletMouseEvent, driverId: string) {
    L.DomEvent.stopPropagation(e.originalEvent)
    toggleIsolate(driverId)
  }

  return (
    <div ref={mapWrapperRef} className="relative w-full h-full" role="application" aria-label="Carte de la flotte">
      {}
      {mapKey === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#09090f] text-gray-600 text-sm">
          Chargement carte…
        </div>
      )}

      {}
      {mapKey > 0 && allPoints.length === 0 && (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center bg-gray-950 text-gray-600 gap-2 pointer-events-none">
          <div className="text-3xl">🗺️</div>
          <div className="text-sm">Aucune donnee geographique</div>
        </div>
      )}

      {mapKey > 0 && <MapContainer
        key={mapKey}
        ref={mapRef}
        style={{ width: '100%', height: '100%', background: '#09090f' }}
        center={center} zoom={11} scrollWheelZoom zoomControl dragging
      >
        <InvalidateSizeOnMount />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd" maxZoom={20}
        />
        <BoundsController points={allPoints} />
        <MapClickHandler onDeselect={() => {}} />

        {}
        {showHeatmap && heatCells.map(cell => {

          const hue = Math.round((1 - cell.intensity) * 200)
          return (
            <CircleMarker
              key={`heat-${cell.lat.toFixed(3)}-${cell.lng.toFixed(3)}`}
              center={[cell.lat, cell.lng]}
              radius={Math.round(12 + cell.intensity * 36)}
              interactive={false}
              pathOptions={{
                fillColor:    `hsl(${hue}, 80%, 50%)`,
                fillOpacity:  0.12 + cell.intensity * 0.38,
                color:        'transparent',
                weight:       0,
              }}
            />
          )
        })}

        {}
        {routes.map(({ driver, color, coords }) => {
          if (coords.length < 2 || !isDriverDimmed(driver.id)) return null
          const geo = roadGeo[driver.id]
          const positions = geo?.coordinates?.length ? geoToLeaflet(geo.coordinates) : coords
          return (
            <Polyline
              key={`route-dim-${driver.id}`}
              positions={positions}
              {...polylineProps(driver.id, color)}
              eventHandlers={{ click: (e) => handleDriverClick(e, driver.id) }}
            />
          )
        })}

        {}
        {routes.map(({ driver, color, coords }) => {
          if (coords.length < 2 || isDriverDimmed(driver.id)) return null
          const geo = roadGeo[driver.id]
          const positions = geo?.coordinates?.length ? geoToLeaflet(geo.coordinates) : coords
          const isIso = isolated.has(driver.id)

          return (
            <React.Fragment key={`route-active-${driver.id}`}>
              {}
              {isIso && (
                <Polyline
                  key={`route-halo-${driver.id}`}
                  positions={positions}
                  color={color} weight={10} opacity={0.2}
                />
              )}
              <Polyline
                key={`route-${driver.id}`}
                positions={positions}
                color={color}
                weight={isIso ? 5 : (loadingRoutes ? 2 : 4)}
                opacity={isIso ? 1 : (loadingRoutes ? 0.4 : 0.85)}
                dashArray={loadingRoutes && !isIso ? '6 4' : undefined}
                eventHandlers={{ click: (e) => handleDriverClick(e, driver.id) }}
              />
            </React.Fragment>
          )
        })}

        {}
        {routes.map(({ driver, color }) => {
          const dep = effectiveDepot(driver, exutoires)
          return (
          <Marker
            key={`depot-${driver.id}`}
            position={[dep.lat, dep.lng]}
            icon={depotIcon(color, isDriverDimmed(driver.id))}
            eventHandlers={{ click: (e) => handleDriverClick(e, driver.id) }}
          >
            <Tooltip direction="top" offset={[0, -16]}>
              <div className="text-xs">
                <div className="font-semibold">{driver.firstName} {driver.lastName}</div>
                <div className="text-gray-400">{driver.startingExutoireId ? exutoires.find(e => e.id === driver.startingExutoireId)?.name ?? driver.depotName : driver.depotName}</div>
              </div>
            </Tooltip>
          </Marker>
        )})}

        {}
        {(() => {
          const MAX_MAP_MARKERS = 500
          const allSteps: Array<{ step: import('@/lib/algorithm').TourStep; driver: typeof drivers[0]; color: string; idx: number; dimmed: boolean }> = []
          for (const driver of drivers) {
            const result = calcResults[driver.id]
            if (!result) continue
            const idx = driverIndex.get(driver.id) ?? 0
            const color = driverColor(idx)
            const dimmed = isDriverDimmed(driver.id)
            for (const step of result.steps) {
              if (step.hasMissingCoords || step.isSynthetic) continue
              allSteps.push({ step, driver, color, idx, dimmed })
              if (allSteps.length >= MAX_MAP_MARKERS) break
            }
            if (allSteps.length >= MAX_MAP_MARKERS) break
          }
          return allSteps.map(({ step, driver, color, dimmed }) => {
            const pm = step.mission
            const isHovered = hoveredMissionId === pm.id
            const typeColor = (MISSION_TYPE_HEX as Record<string, string>)[pm.type] ?? '#6b7280'
            const emoji = tradeMissionIcon(pm.type) || '📍'
            return (
              <Marker
                key={`mission-${pm.id}`}
                position={[pm.latitude, pm.longitude]}
                icon={missionIcon(typeColor, emoji, isHovered, dimmed)}
                zIndexOffset={isHovered ? 1000 : dimmed ? -100 : 0}
                eventHandlers={{ click: (e) => handleDriverClick(e, driver.id) }}
              >
                <Tooltip direction="top" offset={[0, isHovered ? -20 : -14]} permanent={isHovered}>
                  <div className="text-xs leading-relaxed">
                    <div className="font-semibold" style={{ color: typeColor }}>
                      {emoji} {pm.clientName || pm.outletName || pm.address}
                    </div>
                    <div className="text-gray-400">{step.arrivalStr} → {step.departureStr}</div>
                    <div style={{ color }} className="opacity-80">
                      {driver.firstName} {driver.lastName}
                    </div>
                  </div>
                </Tooltip>
              </Marker>
            )
          })
        })()}

        {}
        {exutoires.map(e => (
          <Marker key={`exutoire-${e.id}`} position={[e.lat, e.lng]} icon={exutoireIcon()}>
            <Tooltip direction="top" offset={[0, -16]}>
              <div className="text-xs">
                <div className="font-semibold text-green-400">{e.name}</div>
                <div className="text-gray-400">{e.address}</div>
              </div>
            </Tooltip>
          </Marker>
        ))}

        {}
        {livePositions && livePositions.map(pos => {
          const driverIdx = drivers.findIndex(d => d.id === pos.driverId)
          const driver = drivers[driverIdx]
          if (!driver) return null
          const color = driverColor(driverIdx)
          const ageMin = Math.round((Date.now() - pos.updatedAt) / 60_000)
          const isStale = ageMin > 30

          return (
            <Marker
              key={`live-${pos.driverId}`}
              position={[pos.lat, pos.lng]}
              icon={L.divIcon({
                className: '',
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                html: `<div style="
                  width:28px;height:28px;border-radius:50%;
                  background:${isStale ? '#9CA3AF' : color};
                  border:3px solid white;
                  box-shadow:0 2px 8px rgba(0,0,0,0.3);
                  display:flex;align-items:center;justify-content:center;
                  font-size:14px;
                  ${pos.ignition ? '' : 'opacity:0.5;'}
                ">🚛</div>`,
              })}
            >
              <Tooltip direction="top" offset={[0, -18]} permanent={false}>
                <div className="text-xs">
                  <div className="font-semibold" style={{ color }}>{driver.firstName} {driver.lastName}</div>
                  <div className="text-gray-500">{pos.speedKmh > 0 ? `${Math.round(pos.speedKmh)} km/h` : 'A l\'arret'}</div>
                  <div className="text-gray-400">{ageMin < 1 ? 'A l\'instant' : ageMin < 60 ? `Il y a ${ageMin} min` : `Il y a ${Math.round(ageMin / 60)}h`}</div>
                  {!pos.ignition && <div className="text-red-400">Moteur eteint</div>}
                </div>
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>}

      {}
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

      {}
      {loadingRoutes && (
        <div className={`absolute ${hasIsolation ? 'top-12' : 'top-3'} right-3 z-[999] flex items-center gap-2 bg-gray-950/90 border border-gray-800 rounded-lg px-3 py-1.5 pointer-events-none`}>
          <svg className="w-3.5 h-3.5 animate-spin text-[#0055A4]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span className="text-[10px] text-gray-400">Traces routiers...</span>
        </div>
      )}

      {}
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

