'use client'

import type { OptimizationResult } from '@/lib/types'

/** What the dispatcher needs right after an optimisation: what was not planned and why. */
export interface OptimizationReportData {
  unassigned: Array<{ id: string; label: string; code: string; message: string }>
  notices:    string[]
}

export function reportFromResult(result: OptimizationResult): OptimizationReportData | null {
  const reasons = result.unassignedReasons ?? {}
  const unassigned = result.unassignedMissions.map(m => ({
    id:      m.id,
    label:   m.clientName || m.address || m.id,
    code:    reasons[m.id]?.code ?? 'OTHER',
    message: reasons[m.id]?.message ?? 'Non placée par l\'optimiseur',
  }))
  // Notices that concern the whole day (drivers left out, congestion) — per-route warnings are
  // already shown on each tour.
  const notices = result.warnings
    .filter(w => !w.driverId || /n'est pas planifié/.test(w.message))
    .map(w => w.message)
  if (unassigned.length === 0 && notices.length === 0) return null
  return { unassigned, notices: [...new Set(notices)] }
}

const CODE_LABEL: Record<string, string> = {
  PAYLOAD: 'Poids', VOLUME: 'Volume', BIN_SIZE: 'Taille benne', SKILL: 'Compétence', CAPACITY: 'Capacité',
  TIME_WINDOW: 'Horaire', P1_DEADLINE: 'Urgence P1', DRIVING_TIME: 'Temps de conduite', WORK_TIME: 'Temps de travail',
  NO_EXUTOIRE: 'Exutoire', NO_DRIVER: 'Chauffeurs', VEHICLE_UNAVAILABLE: 'Véhicules', NEEDS_GEOCODE: 'Adresse', OTHER: 'Autre',
}

export function OptimizationReport({ data, onDismiss }: { data: OptimizationReportData; onDismiss: () => void }) {
  return (
    <section aria-labelledby="opt-report-title" className="mx-2 md:mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <h2 id="opt-report-title" className="text-sm font-semibold text-amber-900">
          {data.unassigned.length > 0
            ? `${data.unassigned.length} mission${data.unassigned.length > 1 ? 's' : ''} non planifiée${data.unassigned.length > 1 ? 's' : ''}`
            : 'À savoir sur cette optimisation'}
        </h2>
        <button type="button" onClick={onDismiss} className="text-xs text-amber-800 hover:text-amber-950 underline-offset-2 hover:underline">
          Masquer
        </button>
      </div>
      {data.notices.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-amber-900">
          {data.notices.map(n => <li key={n}>{n}</li>)}
        </ul>
      )}
      {data.unassigned.length > 0 && (
        <ul className="mt-2 divide-y divide-amber-200/70 max-h-56 overflow-y-auto">
          {data.unassigned.map(u => (
            <li key={u.id} className="py-1.5 flex items-start gap-2 text-xs">
              <span className="shrink-0 rounded-md bg-white/80 px-1.5 py-0.5 font-medium text-amber-900 ring-1 ring-amber-200">
                {CODE_LABEL[u.code] ?? u.code}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-surface-900">{u.label}</span>
                <span className="text-surface-600"> — {u.message}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
