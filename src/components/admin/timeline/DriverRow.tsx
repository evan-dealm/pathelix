'use client'

import { useState, memo } from 'react'
import { Driver, PlannedMission, MISSION_TYPE_HEX } from '@/lib/types'
import { useTrade } from '@/providers/TradeProvider'
import { TourResult, formatDuration } from '@/lib/algorithm'
import { P1Badge, LegalBar } from '../ui'
import { TL_HOURS, LEGAL_MAX_DRIVING_MIN, LEGAL_MAX_WORK_MIN } from '../types'
import { tlLeft, tlWidth, mTitle } from '../hooks'
import { MissionBlock } from './MissionBlock'
import { TravelBlock } from './TravelBlock'

export const DriverRow = memo(function DriverRow({ driver, result, plan, startTime, onDrop, isOver, onSetStartTime, onUnassign, onClearPlan, onEditMission, onMoveUp, onMoveDown, onViewDriver, onViewMission, onDragStartMission, onDragEndMission, unavailable, locked, onToggleLock, compact, onCopyPlanTo, allDrivers }: {
  driver: Driver
  result: TourResult | null
  plan: PlannedMission[]
  startTime: string
  onDrop: () => void
  isOver: boolean
  onSetStartTime: (_t: string) => void
  onUnassign: (_missionId: string) => void
  onClearPlan: () => void
  onEditMission: (_m: PlannedMission) => void
  onMoveUp: (_missionId: string) => void
  onMoveDown: (_missionId: string) => void
  onViewDriver: () => void
  onViewMission: (_m: PlannedMission) => void
  onDragStartMission?: (_missionId: string) => void
  onDragEndMission?: () => void
  unavailable?: boolean
  locked?: boolean
  onToggleLock?: () => void
  compact?: boolean
  onCopyPlanTo?: (_targetDriverId: string) => void
  allDrivers?: Driver[]
}) {
  const { missionIcon, missionLabel } = useTrade()
  const [expanded, setExpanded] = useState(false)
  const [hoverDriverId, setHoverDriverId] = useState(false)

  const initials = `${(driver.firstName || '?')[0]}`
  const warnings = result?.warnings || []
  const hasError = warnings.some(w => w.severity === 'error')
  const hasWarn  = warnings.some(w => w.severity === 'warning')

  const [sh, sm] = startTime.split(':').map(Number)
  const startMin = (sh || 0) * 60 + (sm || 0)

  return (
    <div className={`border-b border-surface-200/40 transition-colors
      ${locked ? 'border-l-2 border-l-amber-500/60' : ''}
      ${isOver && !locked ? 'bg-[#0055A4]/8' : hoverDriverId ? 'bg-white/[0.01]' : ''}`}
      onMouseEnter={() => setHoverDriverId(true)}
      onMouseLeave={() => setHoverDriverId(false)}
    >
      {}
      <div className="flex items-stretch" style={{ minHeight: compact ? '44px' : '72px' }}>

        {}
        <div className={`w-44 flex-shrink-0 border-r border-surface-200/40 flex flex-col justify-center px-3 ${compact ? 'py-1 gap-0.5' : 'py-2 gap-1.5'}`}>
          <button type="button" onClick={onViewDriver} className="flex items-center gap-2 w-full text-left group/drv">
            <div className={`${compact ? 'w-5 h-5 text-[9px]' : 'w-7 h-7 text-[11px]'} rounded-full flex items-center justify-center font-black flex-shrink-0 transition-all
              ${unavailable
                ? 'bg-surface-200/40 text-surface-400 ring-1 ring-gray-600/30'
                : hasError
                  ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
                  : hasWarn
                    ? 'bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/30'
                    : 'bg-[#0055A4]/20 text-[#0055A4] group-hover/drv:bg-[#0055A4]/30'}`}>
              {initials}
            </div>
            <div className="min-w-0">
              <div className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-bold truncate leading-tight ${unavailable ? 'text-surface-400 line-through' : 'text-surface-900'}`}>{driver.firstName} {driver.lastName}</div>
              {!compact && <div className="text-surface-400 text-[9px] truncate mt-0.5">{unavailable ? '🔴 Indisponible' : driver.sector}</div>}
            </div>
          </button>

          {!compact && (
            <div className="flex items-center gap-1">
              <input type="time" value={startTime} onChange={e => onSetStartTime(e.target.value)}
                title="Heure de départ"
                className="bg-surface-100/80 border border-surface-200/60 rounded-lg px-2 py-1 text-surface-600 text-[11px] font-mono focus:outline-none focus:border-[#0055A4] transition-colors w-full" />
            </div>
          )}

          {result ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-surface-400 font-medium">{formatDuration(result.totalDurationMin)}</span>
                <span className="text-surface-300 text-[9px]">·</span>
                <span className="text-[9px] text-[#0055A4]/70 font-medium">{Math.round(result.totalRoadDistKm * 10) / 10} km</span>
              </div>
              {}
              {(() => {
                const pct = Math.min(110, (result.totalDurationMin / LEGAL_MAX_WORK_MIN) * 100)
                const barColor = pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-orange-400' : pct >= 50 ? 'bg-[#0055A4]' : 'bg-green-500'
                return (
                  <div className="w-full mt-0.5" title={`Charge : ${Math.round(pct)}%`}>
                    <div className="h-1 bg-surface-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                        style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                )
              })()}
            </>
          ) : (
            <div className="text-[9px] text-surface-300 italic">Aucune mission</div>
          )}
        </div>

        {}
        <div
          className={`flex-1 relative transition-colors ${isOver && !locked ? 'bg-[#0055A4]/5' : ''}`}
          onDragOver={e => { if (!locked) e.preventDefault() }}
          onDrop={e => { if (!locked) { e.preventDefault(); onDrop() } }}
        >
          {}
          {TL_HOURS.map(h => (
            <div key={h} className="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: tlLeft(h * 60), borderLeft: h % 4 === 0 ? '1px solid #374151' : '1px solid #1f2937' }} />
          ))}

          {}
          {plan.length === 0 && (
            <div className={`absolute inset-0 flex items-center justify-center transition-all pointer-events-none`}>
              {isOver ? (
                <span className="text-[#0055A4] text-xs font-semibold bg-[#0055A4]/10 border border-[#0055A4]/30 border-dashed rounded-lg px-4 py-1.5">
                  ↓ Déposer ici
                </span>
              ) : (
                <span className="text-surface-200 text-[10px]">Glisser des missions ici</span>
              )}
            </div>
          )}

          {}
          {result && (
            <div className="absolute top-1 bottom-1 w-1.5 rounded-sm bg-[#0055A4]/60 pointer-events-none"
              style={{ left: tlLeft(startMin) }} title={`Départ dépôt ${startTime}`} />
          )}

          {}
          {result?.steps.map(step => {
            const tw = step.mission.timeWindow
            if (!tw) return null
            const late = step.arrivalMin > tw.closeMin
            return (
              <div key={`tw-${step.mission.id}`}
                className={`absolute top-1 bottom-6 rounded-sm pointer-events-none border border-dashed ${late ? 'bg-red-500/8 border-red-500/30' : 'bg-green-500/6 border-green-500/20'}`}
                style={{ left: tlLeft(tw.openMin), width: tlWidth(tw.closeMin - tw.openMin) }}
                title={`Fenêtre : ${String(Math.floor(tw.openMin / 60)).padStart(2, '0')}:${String(tw.openMin % 60).padStart(2, '0')} — ${String(Math.floor(tw.closeMin / 60)).padStart(2, '0')}:${String(tw.closeMin % 60).padStart(2, '0')}${late ? ' (DÉPASSÉE)' : ''}`}
              />
            )
          })}

          {}
          {result?.steps.map((step, i) => {
            const travelStart = i === 0 ? startMin : result.steps[i - 1].departureMin
            return (
              <span key={step.mission.id}>
                {step.travelMin > 0 && (
                  <TravelBlock
                    startMin={travelStart} durationMin={step.travelMin}
                    label={`${Math.round(step.roadDistKm * 10) / 10} km · ${formatDuration(step.travelMin)}`}
                  />
                )}
                <MissionBlock
                  startMin={step.arrivalMin} durationMin={step.onSiteMin}
                  color={MISSION_TYPE_HEX[step.mission.type] || '#6b7280'}
                  icon={missionIcon(step.mission.type)}
                  name={mTitle(step.mission)}
                  arrivalStr={step.arrivalStr}
                  departureStr={step.departureStr}
                  onView={() => onViewMission(step.mission)}
                  draggable={!step.mission.isSynthetic}
                  onDragStart={() => onDragStartMission?.(step.mission.id)}
                  onDragEnd={() => onDragEndMission?.()}
                />
              </span>
            )
          })}

          {}
          {result && result.returnTravelMin > 0 && (
            <TravelBlock
              startMin={result.steps[result.steps.length - 1]?.departureMin ?? startMin}
              durationMin={result.returnTravelMin}
              label={`Retour dépôt · ${formatDuration(result.returnTravelMin)}`}
            />
          )}

          {}
          {result && (
            <div className="absolute top-1 bottom-1 w-0.5 bg-gray-500/60 pointer-events-none"
              style={{ left: tlLeft(result.finishMin) }} title={`Fin ${result.finishStr}`} />
          )}
        </div>

        {}
        <div className="w-8 flex-shrink-0 flex flex-col items-center justify-center gap-0.5 border-l border-surface-200 px-1">
          {onToggleLock && (
            <button type="button" onClick={onToggleLock} title={locked ? 'Déverrouiller le planning' : 'Verrouiller le planning'}
              className={`w-6 h-6 flex items-center justify-center rounded transition-colors text-xs
                ${locked ? 'text-amber-400 hover:text-amber-300 bg-amber-500/10' : 'text-surface-300 hover:text-surface-500 hover:bg-surface-100'}`}>
              {locked ? '🔒' : '🔓'}
            </button>
          )}
          <button onClick={() => setExpanded(e => !e)} title="Détails"
            className="w-6 h-6 flex items-center justify-center text-surface-400 hover:text-surface-600 hover:bg-surface-100 rounded transition-colors text-xs">
            {expanded ? '▲' : '▼'}
          </button>
          {plan.length > 0 && !locked && (
            <button onClick={onClearPlan} title="Vider le planning"
              className="w-6 h-6 flex items-center justify-center text-surface-300 hover:text-red-400 hover:bg-surface-100 rounded transition-colors text-xs">
              ✕
            </button>
          )}
          {hasError && <span title="Alerte légale" className="text-red-400 text-[10px]">⚠</span>}
        </div>
      </div>

      {}
      {expanded && (
        <div className="border-t border-surface-200 px-4 py-3 bg-surface-50/50">
          {}
          {warnings.length > 0 && (
            <div className="mb-3 space-y-1">
              {warnings.map((w, i) => (
                <div key={i} className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg
                  ${w.severity === 'error' ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/20'}`}>
                  <span className="flex-shrink-0">⚠</span>
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {}
          {plan.length > 0 ? (
            <div className="space-y-1">
              {[...plan].sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((pm, i) => {
                const step = result?.steps[i]
                return (
                  <div key={pm.id}
                    draggable={!pm.isSynthetic}
                    onDragStart={() => onDragStartMission?.(pm.id)}
                    onDragEnd={() => onDragEndMission?.()}
                    className={`flex items-center gap-2 bg-white rounded-lg px-3 py-2 ${!pm.isSynthetic ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                    <span className="text-surface-400 text-[11px] w-4 text-center">{pm.sequenceOrder}</span>
                    <span style={{ color: MISSION_TYPE_HEX[pm.type] }} className="text-xs">{missionIcon(pm.type)}</span>
                    <span className="text-surface-900 text-xs flex-1 truncate">{mTitle(pm) || missionLabel(pm.type)}</span>
                    {pm.priority === 1 && <P1Badge />}
                    {step && (
                      <span className="text-surface-400 text-[11px] flex-shrink-0">
                        {step.arrivalStr} → {step.departureStr}
                      </span>
                    )}
                    {pm.manualStartMin !== undefined && (
                      <span title="Heure forcée manuellement" className="text-yellow-500 text-[10px] flex-shrink-0">📌</span>
                    )}
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => onMoveUp(pm.id)} title="Monter"
                        className="w-5 h-5 flex items-center justify-center text-surface-300 hover:text-surface-600 hover:bg-surface-100 rounded text-xs">↑</button>
                      <button onClick={() => onMoveDown(pm.id)} title="Descendre"
                        className="w-5 h-5 flex items-center justify-center text-surface-300 hover:text-surface-600 hover:bg-surface-100 rounded text-xs">↓</button>
                      <button onClick={() => onEditMission(pm)} title="Modifier"
                        className="w-5 h-5 flex items-center justify-center text-surface-300 hover:text-blue-400 hover:bg-surface-100 rounded text-xs">✏</button>
                      <button onClick={() => onUnassign(pm.id)} title="Retirer"
                        className="w-5 h-5 flex items-center justify-center text-surface-300 hover:text-red-400 hover:bg-surface-100 rounded text-xs">✕</button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-surface-300 text-xs text-center py-2">Aucune mission planifiée</div>
          )}

          {}
          {plan.length > 0 && onCopyPlanTo && allDrivers && allDrivers.length > 1 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] text-surface-400">Dupliquer vers :</span>
              <select
                title="Chauffeur cible pour la copie du plan"
                defaultValue=""
                onChange={e => { if (e.target.value) { onCopyPlanTo(e.target.value); e.target.value = '' } }}
                className="bg-surface-100 border border-surface-200/60 rounded-lg px-2 py-1 text-[11px] text-surface-500 focus:outline-none focus:border-[#0055A4]"
              >
                <option value="" disabled>Choisir un chauffeur…</option>
                {allDrivers.filter(d => d.id !== driver.id && !d.archived).map(d => (
                  <option key={d.id} value={d.id}>{d.firstName} {d.lastName} — {d.sector}</option>
                ))}
              </select>
            </div>
          )}

          {}
          {result && (
            <div className="mt-3 pt-3 border-t border-surface-200 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Durée',     value: formatDuration(result.totalDurationMin) },
                  { label: 'Distance',  value: `${Math.round(result.totalRoadDistKm * 10) / 10} km` },
                  { label: 'Conduite',  value: formatDuration(result.totalDrivingMin) },
                  { label: 'Sur site',  value: formatDuration(result.totalOnSiteMin) },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <div className="text-surface-900 text-xs font-bold">{s.value}</div>
                    <div className="text-surface-400 text-[10px]">{s.label}</div>
                  </div>
                ))}
              </div>
              {}
              <div className="space-y-2">
                <LegalBar valueMin={result.totalDrivingMin} maxMin={LEGAL_MAX_DRIVING_MIN} label="Conduite (max 9h)" />
                <LegalBar valueMin={result.totalDurationMin} maxMin={LEGAL_MAX_WORK_MIN}   label="Travail (max 10h)" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}, (prev, next) =>
  prev.driver     === next.driver     &&
  prev.result     === next.result     &&
  prev.plan       === next.plan       &&
  prev.startTime  === next.startTime  &&
  prev.isOver     === next.isOver     &&
  prev.unavailable === next.unavailable &&
  prev.locked     === next.locked     &&
  prev.compact    === next.compact

)
