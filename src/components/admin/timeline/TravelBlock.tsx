'use client'

import { memo } from 'react'
import { TL_START, TL_END } from '../types'
import { tlLeft, tlWidth } from '../hooks'

export const TravelBlock = memo(function TravelBlock({ startMin, durationMin, label }: {
  startMin: number; durationMin: number; label: string
}) {
  if (startMin + durationMin < TL_START || startMin > TL_END || durationMin <= 0) return null
  return (
    <div
      title={label}
      className="absolute bottom-1.5 h-3 rounded-sm overflow-hidden pointer-events-none"
      style={{ left: tlLeft(startMin), width: tlWidth(durationMin), backgroundColor: '#374151', minWidth: '2px', opacity: 0.7 }}
    >
      <div className="h-full px-1 flex items-center overflow-hidden">
        <span className="text-surface-500 text-[8px] whitespace-nowrap overflow-hidden leading-none">🚛 {label}</span>
      </div>
    </div>
  )
})
