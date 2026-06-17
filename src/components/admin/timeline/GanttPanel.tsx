'use client'

import { useMemo, useRef, useState, useCallback } from 'react'
import { PlannedMission, MISSION_TYPE_HEX } from '@/lib/types'
import { TourResult } from '@/lib/algorithm'
import { usePlanningStore } from '@/stores/planningStore'
import { TL_START, TL_END, TL_RANGE, TL_HOURS } from '../types'
import { DateNav } from '../ui'
import { displayFull } from '../hooks'

function pct(min: number): string {
  const clamped = Math.max(TL_START, Math.min(TL_END, min))
  return `${((clamped - TL_START) / TL_RANGE) * 100}%`
}

function widthPct(durationMin: number): string {
  return `${Math.max(0.5, (durationMin / TL_RANGE) * 100)}%`
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

interface GanttBar {
  mission:     PlannedMission
  startMin:    number
  endMin:      number
  index:       number
}

function computeBars(
  plan:      PlannedMission[],
  result:    TourResult | null,
  startTime: string,
): GanttBar[] {
  const sorted = plan.slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder)

  if (result && result.steps.length > 0) {
    return result.steps
      .filter(s => !s.isSynthetic)
      .map((step, idx) => ({
        mission:  step.mission,
        startMin: step.arrivalMin,
        endMin:   step.departureMin,
        index:    idx,
      }))
  }

  const [sh, sm] = startTime.split(':').map(Number)
  let cursor = (sh || 7) * 60 + (sm || 0)
  return sorted.map((m, idx) => {
    const start = cursor
    const dur   = (m.estimatedDurationMin || 30) + (m.maneuverTimeMin || 0)
    cursor      += dur + 15
    return { mission: m, startMin: start, endMin: start + dur, index: idx }
  })
}

export function GanttPanel({
  planDate,
  setPlanDate,
  calcResults,
  onEditPlanned,
  defaultStartTime,
}: {
  planDate:         string
  setPlanDate:      (_d: string) => void
  calcResults:      Record<string, TourResult | null>
  onEditPlanned:    (_m: PlannedMission, _driverId: string, _date: string) => void
  defaultStartTime?: string
}) {
  const storeDrivers   = usePlanningStore(s => s.drivers)
  const storePlans     = usePlanningStore(s => s.plans)
  const storeStartTimes = usePlanningStore(s => s.startTimes)
  const reorderMissions = usePlanningStore(s => s.reorderMissions)
  const assignToDriver  = usePlanningStore(s => s.assignToDriver)

  const [dragInfo, setDragInfo] = useState<{ missionId: string; fromDriverId: string; fromIndex: number } | null>(null)
  const [tooltip, setTooltip]   = useState<{ bar: GanttBar; x: number; y: number } | null>(null)
  const [hoveredDriver, setHoveredDriver] = useState<string | null>(null)

  const activeDrivers = useMemo(
    () => (Array.isArray(storeDrivers) ? storeDrivers : []).filter(d => !d.archived),
    [storeDrivers],
  )

  const containerRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => activeDrivers.map(driver => {
    const key       = `${driver.id}|${planDate}`
    const plan      = storePlans[key] || []
    const startTime = storeStartTimes[key] || defaultStartTime || '07:00'
    const result    = calcResults[driver.id] || null
    const bars      = computeBars(plan, result, startTime)
    return { driver, plan, bars }
  }), [activeDrivers, storePlans, storeStartTimes, calcResults, planDate, defaultStartTime])

  const handleDragStart = useCallback((
    e: React.DragEvent,
    missionId: string,
    fromDriverId: string,
    fromIndex: number,
  ) => {
    e.dataTransfer.effectAllowed = 'move'
    setDragInfo({ missionId, fromDriverId, fromIndex })
  }, [])

  const handleDrop = useCallback((
    e: React.DragEvent,
    toDriverId: string,
    toIndex: number,
  ) => {
    e.preventDefault()
    if (!dragInfo) return
    const { missionId, fromDriverId, fromIndex } = dragInfo

    if (fromDriverId === toDriverId) {

      reorderMissions(toDriverId, planDate, fromIndex, toIndex)
    } else {

      assignToDriver(missionId, toDriverId, planDate)
    }
    setDragInfo(null)
  }, [dragInfo, planDate, reorderMissions, assignToDriver])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">

      {}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-200 bg-surface-50/60 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          <span className="text-xs font-bold text-surface-600 uppercase tracking-widest">Gantt</span>
        </div>
        <DateNav dateStr={planDate} setDate={setPlanDate} />
        <span className="text-surface-400 text-xs hidden md:block capitalize">{displayFull(planDate)}</span>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-surface-400">
          {dragInfo && (
            <span className="text-blue-500 font-semibold animate-pulse bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
              Glisser vers un autre chauffeur pour réassigner
            </span>
          )}
          <span>Glisser les barres pour réordonner</span>
        </div>
      </div>

      {}
      <div className="flex flex-shrink-0 border-b border-surface-200 bg-surface-50">
        <div className="w-44 flex-shrink-0 border-r border-surface-200" />
        <div className="flex-1 relative overflow-hidden" style={{ height: '28px' }}>
          {TL_HOURS.map(h => (
            <div key={h}
              className="absolute top-0 flex flex-col items-center pointer-events-none"
              style={{ left: pct(h * 60) }}>
              <div className="h-2 w-px bg-surface-200 mt-1" />
              <span className="text-[9px] text-surface-400 -translate-x-1/2 mt-0.5 font-medium">
                {String(h).padStart(2, '0')}h
              </span>
            </div>
          ))}
        </div>
      </div>

      {}
      <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {activeDrivers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-surface-400 text-sm gap-2">
            <div className="text-3xl">🚛</div>
            <div>Aucun chauffeur actif</div>
          </div>
        ) : (
          rows.map(({ driver, plan, bars }) => (
            <div
              key={driver.id}
              className={`flex border-b border-surface-100 transition-colors ${
                hoveredDriver === driver.id ? 'bg-blue-50/30' : ''
              } ${dragInfo && dragInfo.fromDriverId !== driver.id ? 'bg-green-50/20 border-l-2 border-l-green-300' : ''}`}
              onMouseEnter={() => setHoveredDriver(driver.id)}
              onMouseLeave={() => setHoveredDriver(null)}
              onDrop={e => handleDrop(e, driver.id, plan.length)}
              onDragOver={handleDragOver}
            >
              {}
              <div className="w-44 flex-shrink-0 border-r border-surface-200 px-3 py-2 flex flex-col justify-center gap-0.5">
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                    style={{ backgroundColor: driver.color || '#6b7280' }}
                  >
                    {driver.firstName[0]}{driver.lastName[0]}
                  </div>
                  <span className="text-[11px] font-semibold text-surface-700 truncate">
                    {driver.firstName} {driver.lastName}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-surface-400 truncate">{driver.sector}</span>
                  {bars.length > 0 && (
                    <span className="text-[9px] font-semibold text-blue-500 ml-auto">
                      {bars.length}m
                    </span>
                  )}
                </div>
              </div>

              {}
              <div className="flex-1 relative" style={{ height: '52px' }}>
                {}
                {TL_HOURS.map(h => (
                  <div
                    key={h}
                    className="absolute top-0 bottom-0 w-px bg-surface-100 pointer-events-none"
                    style={{ left: pct(h * 60) }}
                  />
                ))}

                {}
                {bars.map((bar, barIdx) => {
                  const color = MISSION_TYPE_HEX[bar.mission.type] || '#6b7280'
                  const isP1  = bar.mission.priority === 1
                  return (
                    <div
                      key={bar.mission.id}
                      draggable
                      onDragStart={e => handleDragStart(e, bar.mission.id, driver.id, barIdx)}
                      onDrop={e => { e.stopPropagation(); handleDrop(e, driver.id, barIdx) }}
                      onDragOver={handleDragOver}
                      onMouseEnter={e => setTooltip({
                        bar,
                        x: e.currentTarget.getBoundingClientRect().left,
                        y: e.currentTarget.getBoundingClientRect().top,
                      })}
                      onMouseLeave={() => setTooltip(null)}
                      onClick={() => onEditPlanned(bar.mission, driver.id, planDate)}
                      className="absolute top-[6px] h-[40px] rounded cursor-grab active:cursor-grabbing flex items-center overflow-hidden shadow-sm border border-white/40 hover:brightness-95 transition-all group"
                      style={{
                        left:            pct(bar.startMin),
                        width:           widthPct(bar.endMin - bar.startMin),
                        backgroundColor: color,
                        opacity:         dragInfo?.missionId === bar.mission.id ? 0.4 : 1,
                      }}
                    >
                      {isP1 && (
                        <div className="absolute top-0.5 right-0.5 w-2 h-2 bg-white rounded-full opacity-90" />
                      )}
                      <div className="px-1.5 truncate text-[9px] font-semibold text-white leading-tight min-w-0">
                        <div className="truncate">{bar.mission.clientName || bar.mission.address}</div>
                        <div className="opacity-75 text-[8px]">
                          {minToHHMM(bar.startMin)}–{minToHHMM(bar.endMin)}
                        </div>
                      </div>
                    </div>
                  )
                })}

                {}
                {bars.length === 0 && dragInfo && (
                  <div className="absolute inset-2 border-2 border-dashed border-green-300 rounded flex items-center justify-center text-[11px] text-green-500">
                    Déposer ici
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {}
      {tooltip && (
        <div
          className="fixed z-[200] bg-gray-900 text-white text-[11px] rounded-lg px-3 py-2 shadow-2xl pointer-events-none max-w-[200px]"
          style={{ top: (tooltip.y - 80), left: tooltip.x }}
        >
          <div className="font-bold truncate">{tooltip.bar.mission.clientName || tooltip.bar.mission.address}</div>
          <div className="text-gray-300">{tooltip.bar.mission.type}</div>
          <div className="text-gray-300">{minToHHMM(tooltip.bar.startMin)} → {minToHHMM(tooltip.bar.endMin)}</div>
          <div className="text-gray-400 text-[10px] mt-0.5 truncate">{tooltip.bar.mission.address}</div>
        </div>
      )}
    </div>
  )
}
