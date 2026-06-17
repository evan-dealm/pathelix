'use client'

import { memo } from 'react'
import { formatDuration } from '@/lib/algorithm'
import { TL_START, TL_END } from '../types'
import { tlLeft, tlWidth } from '../hooks'

export const MissionBlock = memo(function MissionBlock({ startMin, durationMin, color, icon, name, arrivalStr, departureStr, onView, draggable, onDragStart, onDragEnd }: {
  startMin: number; durationMin: number; color: string
  icon: string; name: string; arrivalStr: string; departureStr: string
  onView: () => void
  draggable?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
}) {
  if (startMin + durationMin < TL_START || startMin > TL_END || durationMin <= 0) return null
  return (
    <div
      onClick={onView}
      draggable={draggable}
      onDragStart={e => { e.stopPropagation(); onDragStart?.() }}
      onDragEnd={onDragEnd}
      title={`${icon} ${name}\n${arrivalStr} → ${departureStr} · ${formatDuration(durationMin)}`}
      className={`absolute top-2 bottom-7 rounded overflow-hidden hover:brightness-115 hover:z-10 hover:scale-y-105 transition-all border border-white/10 shadow-sm ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      style={{ left: tlLeft(startMin), width: tlWidth(durationMin), backgroundColor: color, minWidth: '5px' }}
    >
      <div className="h-full px-1.5 pt-1 pb-0.5 flex flex-col justify-between overflow-hidden pointer-events-none">
        <div className="flex items-center gap-0.5 overflow-hidden">
          <span className="text-[11px] leading-none flex-shrink-0">{icon}</span>
          <span className="text-surface-900 text-[10px] font-bold truncate leading-none ml-0.5 drop-shadow">{name}</span>
        </div>
        <div className="text-surface-900/80 text-[9px] leading-none whitespace-nowrap overflow-hidden drop-shadow">
          {arrivalStr} → {departureStr}
        </div>
      </div>
    </div>
  )
}, (prev, next) =>
  prev.startMin    === next.startMin    &&
  prev.durationMin === next.durationMin &&
  prev.color       === next.color       &&
  prev.icon        === next.icon        &&
  prev.name        === next.name        &&
  prev.arrivalStr  === next.arrivalStr  &&
  prev.departureStr === next.departureStr &&
  prev.draggable   === next.draggable
)
