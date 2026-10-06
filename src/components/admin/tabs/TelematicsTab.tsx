'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { usePlanningStore } from '@/stores/planningStore'

const LiveTrackingMap = dynamic(
  () => import('@/components/LiveTrackingMap').then(m => ({ default: m.LiveTrackingMap })),
  { ssr: false, loading: () => <div className="h-[300px] bg-surface-100 rounded-xl flex items-center justify-center text-surface-400 text-sm">Chargement carte...</div> },
)

interface SpeedPoint {
  minuteOfDay: number
  speedKmh:    number
}

interface DriverPosition {
  driverId:  string
  lat:       number
  lng:       number
  speedKmh:  number
  ignition:  boolean
  updatedAt: number
}

interface TelematicsData {
  positions: DriverPosition[]
  history:   Record<string, SpeedPoint[]>
}

const GRAPH_W    = 560
const GRAPH_H    = 80
const START_MIN  = 5 * 60
const END_MIN    = 22 * 60
const RANGE      = END_MIN - START_MIN
const STOPPED_V  = 3
const MAX_V      = 120

function minToX(min: number): number {
  return Math.max(0, Math.min(GRAPH_W, ((min - START_MIN) / RANGE) * GRAPH_W))
}

function speedToY(v: number): number {
  return GRAPH_H - Math.min(GRAPH_H, (Math.min(v, MAX_V) / MAX_V) * GRAPH_H)
}

function SpeedGraph({ points, currentMin }: { points: SpeedPoint[]; currentMin: number }) {
  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-[80px] text-surface-300 text-xs">
        Aucune donnée
      </div>
    )
  }

  const filtered = points.filter(p => p.minuteOfDay >= START_MIN && p.minuteOfDay <= END_MIN)
  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-[80px] text-surface-300 text-xs">
        Aucune donnée dans la plage 05h–22h
      </div>
    )
  }

  const polyPoints = filtered.map(p => `${minToX(p.minuteOfDay)},${speedToY(p.speedKmh)}`).join(' ')

  const areaPoints = [
    `${minToX(filtered[0].minuteOfDay)},${GRAPH_H}`,
    ...filtered.map(p => `${minToX(p.minuteOfDay)},${speedToY(p.speedKmh)}`),
    `${minToX(filtered[filtered.length - 1].minuteOfDay)},${GRAPH_H}`,
  ].join(' ')

  const stoppedZones: Array<{ x1: number; x2: number }> = []
  let zoneStart: number | null = null
  for (const p of filtered) {
    if (p.speedKmh < STOPPED_V) {
      if (zoneStart === null) zoneStart = p.minuteOfDay
    } else {
      if (zoneStart !== null) {
        stoppedZones.push({ x1: minToX(zoneStart), x2: minToX(p.minuteOfDay) })
        zoneStart = null
      }
    }
  }
  if (zoneStart !== null) {
    stoppedZones.push({ x1: minToX(zoneStart), x2: minToX(END_MIN) })
  }

  const cursorX = currentMin >= START_MIN && currentMin <= END_MIN ? minToX(currentMin) : null

  const hourTicks = []
  for (let h = 6; h <= 22; h += 2) {
    const x = minToX(h * 60)
    hourTicks.push({ x, label: `${h}h` })
  }

  return (
    <svg viewBox={`0 0 ${GRAPH_W} ${GRAPH_H + 14}`} className="w-full" style={{ height: `${GRAPH_H + 14}px` }}>
      {}
      {[30, 60, 90].map(v => (
        <line key={v}
          x1={0} y1={speedToY(v)} x2={GRAPH_W} y2={speedToY(v)}
          stroke="#1f2937" strokeWidth="0.5" strokeDasharray="4,4" />
      ))}

      {}
      {stoppedZones.map((z, i) => (
        <rect key={i} x={z.x1} y={0} width={Math.max(1, z.x2 - z.x1)} height={GRAPH_H}
          fill="#374151" fillOpacity="0.4" />
      ))}

      {}
      <polygon points={areaPoints} fill="#0055A4" fillOpacity="0.18" />

      {}
      <polyline points={polyPoints} fill="none" stroke="#0055A4" strokeWidth="1.5" strokeLinejoin="round" />

      {}
      {cursorX !== null && (
        <line x1={cursorX} y1={0} x2={cursorX} y2={GRAPH_H}
          stroke="#ef4444" strokeWidth="1" strokeDasharray="3,2" />
      )}

      {}
      {hourTicks.map(({ x, label }) => (
        <g key={label}>
          <line x1={x} y1={GRAPH_H} x2={x} y2={GRAPH_H + 3} stroke="#374151" strokeWidth="1" />
          <text x={x} y={GRAPH_H + 11} textAnchor="middle" fontSize="8" fill="#4b5563">{label}</text>
        </g>
      ))}
    </svg>
  )
}

function speedStats(points: SpeedPoint[]): { vmax: number; vmoy: number; stops: number } {
  if (points.length === 0) return { vmax: 0, vmoy: 0, stops: 0 }
  const vmax = Math.max(...points.map(p => p.speedKmh))
  const vmoy = Math.round(points.reduce((s, p) => s + p.speedKmh, 0) / points.length)

  let stops = 0
  let inStop = false
  for (const p of points) {
    if (p.speedKmh < STOPPED_V) {
      if (!inStop) { stops++; inStop = true }
    } else {
      inStop = false
    }
  }
  return { vmax: Math.round(vmax), vmoy, stops }
}

interface Props {
  date: string
}

export function TelematicsTab({ date }: Props) {
  const storeDrivers = usePlanningStore(s => s.drivers)
  const drivers = (Array.isArray(storeDrivers) ? storeDrivers : []).filter(d => !d.archived)

  const [data, setData]     = useState<TelematicsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const now     = new Date()
  const currentMin = now.getHours() * 60 + now.getMinutes()

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/driver-position?date=${date}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as TelematicsData
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void fetchData()
    const id = setInterval(() => { void fetchData() }, 30_000)
    return () => clearInterval(id)
  }, [fetchData])

  const hasAnyData = data && (data.positions.length > 0 || Object.keys(data.history).length > 0)

  if (!loading && !hasAnyData) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center gap-6 text-center">
        <div className="text-5xl">📡</div>
        <div>
          <p className="text-surface-900 font-semibold text-lg mb-1">Aucune donnee de suivi</p>
          <p className="text-surface-400 text-sm max-w-md">
            Les positions GPS des chauffeurs apparaissent ici automatiquement quand ils ouvrent
            l&apos;application mobile. Chaque chauffeur envoie sa position toutes les 30 secondes.
          </p>
        </div>

        <div className="bg-white border border-surface-200 rounded-xl p-5 text-left w-full max-w-lg">
          <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-3">Comment ca fonctionne</p>
          <div className="space-y-2 text-xs text-surface-600">
            <div className="flex items-start gap-2">
              <span className="text-brand-500 font-bold shrink-0">1.</span>
              <span>Le chauffeur ouvre sa page sur son téléphone (<code className="text-surface-500">/driver/[id]</code>)</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-brand-500 font-bold shrink-0">2.</span>
              <span>Le GPS du téléphone envoie la position toutes les 30 secondes</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-brand-500 font-bold shrink-0">3.</span>
              <span>Les graphiques de vitesse et positions apparaissent ici en temps réel</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-brand-500 font-bold shrink-0">4.</span>
              <span>En zone blanche, les positions sont stockees localement puis envoyees au retour du réseau</span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-surface-100">
            <p className="text-surface-400 text-[10px]">
              Compatible aussi avec les boîtiers télématiques (Geotab, Samsara) — configurez-les dans Paramètres &gt; Intégrations.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-red-400 text-xs">Erreur de chargement : {error}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      {}
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📡</span>
          <h2 className="text-surface-900 font-bold text-base">Télématique</h2>
          <span className="text-surface-400 text-xs ml-1">{date}</span>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <svg className="w-3.5 h-3.5 animate-spin text-[#0055A4]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          )}
          <button
            type="button"
            onClick={() => { void fetchData() }}
            className="text-xs text-surface-400 hover:text-surface-600 border border-surface-200 hover:border-surface-200 rounded-lg px-3 py-1.5 transition-colors"
          >
            Actualiser
          </button>
          <span className="text-[10px] text-surface-300">Auto 30s</span>
        </div>
      </div>

      {}
      {data && data.positions.length > 0 && (
        <div className="mb-4">
          <LiveTrackingMap
            positions={data.positions}
            drivers={drivers}
            height="300px"
          />
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 text-red-400 text-xs">
          Erreur : {error}
        </div>
      )}

      {}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {drivers.map(driver => {
          const points   = data?.history?.[driver.id] ?? []
          const position = data?.positions?.find(p => p.driverId === driver.id)
          const stats    = speedStats(points)
          const isActive = position && (Date.now() - position.updatedAt) < 5 * 60_000

          return (
            <div key={driver.id} className="bg-white border border-surface-200 rounded-xl overflow-hidden">
              {}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-200">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    isActive
                      ? position?.ignition
                        ? 'bg-green-400 animate-pulse'
                        : 'bg-yellow-400'
                      : 'bg-surface-200'
                  }`} />
                  <span className="text-surface-900 text-sm font-semibold">
                    {driver.firstName} {driver.lastName}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {position && (
                    <span className={`text-xs font-bold tabular-nums ${
                      position.speedKmh > 90 ? 'text-orange-400' :
                      position.speedKmh > 0  ? 'text-green-400' :
                      'text-surface-400'
                    }`}>
                      {Math.round(position.speedKmh)} km/h
                    </span>
                  )}
                  <span className="text-surface-300 text-[10px]">{driver.sector}</span>
                </div>
              </div>

              {}
              <div className="px-2 pt-2 pb-0">
                <SpeedGraph points={points} currentMin={currentMin} />
              </div>

              {}
              {points.length > 0 && (
                <div className="flex items-center gap-3 px-3 py-2 border-t border-surface-200/40">
                  {[
                    { label: 'Vmax',  value: `${stats.vmax} km/h` },
                    { label: 'Vmoy',  value: `${stats.vmoy} km/h` },
                    { label: 'Arrêts', value: String(stats.stops) },
                  ].map(s => (
                    <div key={s.label} className="flex flex-col items-start">
                      <span className="text-surface-900 text-xs font-semibold tabular-nums">{s.value}</span>
                      <span className="text-surface-400 text-[10px] uppercase tracking-wider">{s.label}</span>
                    </div>
                  ))}
                  {position && (
                    <div className="ml-auto text-[10px] text-surface-300">
                      MàJ {new Date(position.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              )}

              {}
              {points.length === 0 && !position && (
                <div className="px-3 py-2 text-surface-300 text-xs italic border-t border-surface-200/40">
                  Aucune donnée reçue
                </div>
              )}
            </div>
          )
        })}
      </div>

      {}
      <div className="mt-6 flex flex-wrap items-center gap-4 text-[10px] text-surface-400">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-[#374151] opacity-70" />
          <span>Arrêt (v &lt; 3 km/h)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-[#0055A4]" />
          <span>Vitesse</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-0.5 h-3 bg-red-500 opacity-70" />
          <span>Heure courante</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span>Moteur allumé (actif &lt; 5 min)</span>
        </div>
      </div>
    </div>
  )
}
