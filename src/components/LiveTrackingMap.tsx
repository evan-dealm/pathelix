'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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
  '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#06B6D4', '#84CC16',
]

function truckIcon(color: string, ignition: boolean) {
  const opacity = ignition ? 1 : 0.6
  const pulse = ignition ? `animation:pulse 1.5s infinite` : ''
  return L.divIcon({
    className: '',
    html: `<div style="width:32px;height:32px;border-radius:50%;background:${color}22;border:2px solid ${color};display:flex;align-items:center;justify-content:center;font-size:16px;opacity:${opacity};${pulse}">🚛</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
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

function AutoBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    try { map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 }) } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length, map])
  return null
}

interface Props {
  positions: LivePosition[]
  drivers:   Driver[]
  height?:   string
}

export function LiveTrackingMap({ positions, drivers, height = '300px' }: Props) {
  const driverMap = useMemo(() => new Map(drivers.map((d, i) => [d.id, { ...d, colorIdx: i }])), [drivers])

  const activePositions = useMemo(
    () => positions.filter(p => (Date.now() - p.updatedAt) < 30 * 60_000),
    [positions],
  )

  const bounds = useMemo<[number, number][]>(
    () => activePositions.map(p => [p.lat, p.lng]),
    [activePositions],
  )

  const defaultCenter: [number, number] = activePositions.length > 0
    ? [activePositions[0].lat, activePositions[0].lng]
    : [46.8, 2.3]

  return (
    <MapContainer
      center={defaultCenter}
      zoom={10}
      style={{ height, width: '100%', borderRadius: '12px', zIndex: 0 }}
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap"
      />
      {bounds.length > 0 && <AutoBounds points={bounds} />}

      {activePositions.map((pos) => {
        const d = driverMap.get(pos.driverId)
        const color = DRIVER_COLORS[(d?.colorIdx ?? 0) % DRIVER_COLORS.length]
        const secAgo = Math.round((Date.now() - pos.updatedAt) / 1000)
        const timeAgo = secAgo < 60 ? `${secAgo}s` : `${Math.round(secAgo / 60)}min`

        return (
          <Marker
            key={pos.driverId}
            position={[pos.lat, pos.lng]}
            icon={truckIcon(color, pos.ignition)}
          >
            <Popup>
              <div style={{ minWidth: 160, fontFamily: 'sans-serif' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {d ? `${d.firstName} ${d.lastName}` : pos.driverId}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {Math.round(pos.speedKmh)} km/h
                  {pos.ignition ? ' · Moteur ON' : ' · Arrêté'}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Mis à jour il y a {timeAgo}
                </div>
              </div>
            </Popup>
          </Marker>
        )
      })}
    </MapContainer>
  )
}
