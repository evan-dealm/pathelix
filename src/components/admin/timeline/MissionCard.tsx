'use client'

import { memo } from 'react'
import { Mission, MISSION_TYPE_HEX } from '@/lib/types'
import { formatDuration } from '@/lib/algorithm'
import { P1Badge } from '../ui'
import { mTitle } from '../hooks'
import { useTrade } from '@/providers/TradeProvider'

export const MissionCard = memo(function MissionCard({ mission, onView, onEdit, onDelete, onDuplicate, dragging, onDragStart, onDragEnd, selectable, selected, onToggleSelect }: {
  mission: Mission
  onView: () => void
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const { missionIcon, missionLabel } = useTrade()
  const totalMin = mission.estimatedDurationMin + mission.maneuverTimeMin
  const hasCoords = mission.latitude !== 0 || mission.longitude !== 0
  const color = MISSION_TYPE_HEX[mission.type]

  return (
    <div
      draggable={!selectable} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={selectable ? onToggleSelect : onView}
      className={`relative bg-white border rounded-xl overflow-hidden ${selectable ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} transition-all select-none group/card
        ${selected ? 'ring-2 ring-[#0055A4] border-[#0055A4]/60' : ''}
        ${dragging
          ? 'opacity-40 scale-95 border-surface-200'
          : 'border-surface-200 hover:border-gray-600/70 hover:shadow-2xl hover:shadow-black/60 hover:-translate-y-0.5'}`}
    >
      {}
      {selectable && (
        <div className="absolute top-2 right-2 z-10">
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all
            ${selected ? 'bg-[#0055A4] border-[#0055A4] text-surface-900' : 'border-gray-600 bg-surface-100'}`}>
            {selected && <span className="text-[10px] leading-none">✓</span>}
          </div>
        </div>
      )}
      {}
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: color }} />

      <div className="pl-3.5 pr-2.5 pt-2.5 pb-2.5">
        {}
        <div className="flex items-center justify-between gap-1 mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm leading-none flex-shrink-0">{missionIcon(mission.type)}</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color }}>
              {missionLabel(mission.type)}
            </span>
          </div>
          <div className="flex items-center gap-0 flex-shrink-0">
            {!hasCoords && <span title="GPS manquant" className="text-yellow-500 text-[10px] mr-1 opacity-70">⚠</span>}
            <div className="flex items-center opacity-0 group-hover/card:opacity-100 transition-opacity">
              <button onClick={e => { e.stopPropagation(); onEdit() }} title="Modifier"
                className="text-surface-400 hover:text-surface-900 w-5 h-5 flex items-center justify-center hover:bg-surface-100 rounded transition-all text-[10px]">✏</button>
              <button onClick={e => { e.stopPropagation(); onDuplicate() }} title="Dupliquer"
                className="text-surface-400 hover:text-surface-900 w-5 h-5 flex items-center justify-center hover:bg-surface-100 rounded transition-all text-[10px]">⎘</button>
              <button onClick={e => { e.stopPropagation(); onDelete() }} title="Supprimer"
                className="text-surface-400 hover:text-red-400 w-5 h-5 flex items-center justify-center hover:bg-surface-100 rounded transition-all text-[10px]">✕</button>
            </div>
          </div>
        </div>

        {}
        {mission.priority === 1 && (
          <div className="mb-1.5">
            <P1Badge />
          </div>
        )}

        {}
        <div className="text-surface-900 text-[13px] font-bold leading-snug truncate">{mTitle(mission)}</div>

        {}
        <div className="text-surface-400 text-[10px] mt-0.5 leading-tight truncate">{mission.address}</div>

        {}
        <div className="flex items-center gap-1 mt-2.5 flex-wrap">
          <span className="inline-flex items-center gap-0.5 bg-surface-100 rounded-md px-1.5 py-0.5 text-[10px] text-surface-500 font-semibold whitespace-nowrap">
            ⏱ {formatDuration(totalMin)}
          </span>
          {mission.wasteTypeLabel && (
            <span className="inline-flex items-center bg-surface-100/70 rounded-md px-1.5 py-0.5 text-[10px] text-surface-400 truncate max-w-[80px]">
              {mission.wasteTypeLabel}
            </span>
          )}
          {mission.binSize && (
            <span className="inline-flex items-center bg-surface-100/70 rounded-md px-1.5 py-0.5 text-[10px] text-surface-400 whitespace-nowrap">
              {mission.binSize}
            </span>
          )}
        </div>

        {mission.accessNotes && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-yellow-600/60 truncate">
            <span>⚡</span><span className="truncate">{mission.accessNotes}</span>
          </div>
        )}
      </div>
    </div>
  )
}, (prev, next) =>
  prev.mission  === next.mission  &&
  prev.dragging === next.dragging &&
  prev.selected === next.selected &&
  prev.selectable === next.selectable
)
