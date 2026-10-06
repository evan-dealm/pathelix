'use client'

import { useState } from 'react'
import { apiRequest } from '@/lib/apiClient'

interface Alternative { driverId: string; driverName: string; chosen: boolean; feasible: boolean; extraKm: number | null; extraMin: number | null; reason?: string }

/** "Why this driver?" for a planned mission: its cost here against every other route. */
export function AssignmentWhy({ date, missionId }: { date: string; missionId: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ alternatives: Alternative[]; excluded: Array<{ driverName: string; reason: string }> } | null>(null)
  const [error, setError] = useState('')
  async function load() {
    setOpen(o => !o)
    if (data) return
    const r = await apiRequest<{ alternatives: Alternative[]; excluded: Array<{ driverName: string; reason: string }> }>(`/api/plans/explain?date=${date}&missionId=${encodeURIComponent(missionId)}`)
    if (r.ok) setData(r.data); else setError(r.error)
  }
  const chosen = data?.alternatives.find(a => a.chosen)
  return (
    <div className="mb-3 rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-xs">
      <button type="button" onClick={() => void load()} aria-expanded={open} className="font-medium text-brand-700 hover:underline">Pourquoi ce chauffeur ?</button>
      {open && error && <p role="alert" className="mt-1 text-red-700">{error}</p>}
      {open && !data && !error && <p role="status" className="mt-1 text-surface-500">Calcul…</p>}
      {open && data && (
        <ul className="mt-2 space-y-1">
          {data.alternatives.map(a => (
            <li key={a.driverId} className={`flex justify-between gap-3 ${a.chosen ? 'font-medium text-surface-900' : 'text-surface-700'}`}>
              <span>{a.driverName}{a.chosen ? ' (planifié)' : ''}</span>
              <span className="text-right tabular-nums">
                {a.feasible && a.extraMin !== null
                  ? <>+{a.extraMin} min · +{a.extraKm} km{!a.chosen && chosen?.extraMin !== null && chosen?.extraMin !== undefined ? <span className="text-surface-500"> ({a.extraMin - chosen.extraMin >= 0 ? '+' : ''}{a.extraMin - chosen.extraMin} min)</span> : null}</>
                  : <span className="text-amber-800">{a.reason ?? 'impossible'}</span>}
              </span>
            </li>
          ))}
          {data.excluded.map(e => <li key={e.driverName} className="flex justify-between gap-3 text-surface-500"><span>{e.driverName}</span><span>non planifiable : {e.reason}</span></li>)}
        </ul>
      )}
    </div>
  )
}
