'use client'

import type { OptimizationResult } from '@/lib/types'

type ParetoEntry = NonNullable<OptimizationResult['stats']['paretoFront']>[number]

const LABEL_STYLE: Record<string, { bg: string; border: string; title: string; icon: string; btn: string }> = {
  'Km minimal':        { bg: 'bg-blue-50',   border: 'border-blue-200',   title: 'text-blue-700',   icon: '📏', btn: 'bg-blue-600 hover:bg-blue-700' },
  'Zero retard':       { bg: 'bg-green-50',  border: 'border-green-200',  title: 'text-green-700',  icon: '⏰', btn: 'bg-green-600 hover:bg-green-700' },
  'Charge equilibree': { bg: 'bg-violet-50', border: 'border-violet-200', title: 'text-violet-700', icon: '⚖️', btn: 'bg-violet-600 hover:bg-violet-700' },
  'Compromis':         { bg: 'bg-amber-50',  border: 'border-amber-200',  title: 'text-amber-700',  icon: '✦',  btn: 'bg-amber-600 hover:bg-amber-700' },
}

export const PARETO_WEIGHTS: Record<string, { distance: number; punctuality: number; balance: number }> = {
  'Km minimal':        { distance: 1,   punctuality: 0.1, balance: 0.1 },
  'Zero retard':       { distance: 0.1, punctuality: 1,   balance: 0.1 },
  'Charge equilibree': { distance: 0.1, punctuality: 0.1, balance: 1   },
  'Compromis':         { distance: 1,   punctuality: 1,   balance: 1   },
}

function getStyle(label: string) {
  return LABEL_STYLE[label] ?? { bg: 'bg-surface-50', border: 'border-surface-200', title: 'text-surface-700', icon: '✦', btn: 'bg-surface-600 hover:bg-surface-700' }
}

export function ParetoSelector({
  front,
  onApply,
  onDismiss,
}: {
  front: ParetoEntry[]
  onApply: (_weights: { distance: number; punctuality: number; balance: number }) => void
  onDismiss: () => void
}) {
  if (front.length === 0) return null

  return (
    <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-surface-600">
          Front Pareto — {front.length} solution{front.length > 1 ? 's' : ''} non-dominée{front.length > 1 ? 's' : ''}
        </span>
        <button type="button" onClick={onDismiss}
          className="text-surface-400 hover:text-surface-600 text-sm leading-none px-1">&times;</button>
      </div>
      <div className="flex gap-2.5 flex-wrap">
        {front.map((entry, i) => {
          const s = getStyle(entry.label)
          return (
            <div key={i} className={`rounded-xl border p-3 flex-1 min-w-[140px] max-w-[200px] ${s.bg} ${s.border}`}>
              <div className={`text-[11px] font-bold mb-1.5 flex items-center gap-1 ${s.title}`}>
                <span>{s.icon}</span>
                <span>{entry.label}</span>
              </div>
              <div className="space-y-0.5 text-[10px] text-surface-600 mb-2.5">
                <div className="flex justify-between gap-2">
                  <span>Distance</span>
                  <span className="font-semibold tabular-nums">{Math.round(entry.totalDistanceKm)} km</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Retard</span>
                  <span className="font-semibold tabular-nums">{Math.round(entry.totalLatenessMin)} min</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Équilibre CV</span>
                  <span className="font-semibold tabular-nums">{(entry.workloadCV * 100).toFixed(0)}%</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onApply(PARETO_WEIGHTS[entry.label] ?? { distance: 1, punctuality: 1, balance: 1 })}
                className={`w-full py-1 rounded-lg text-[10px] font-semibold text-white transition-all active:scale-95 ${s.btn}`}
              >
                Appliquer
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
