'use client'

import { usePlanningStore } from '@/stores/planningStore'

/**
 * Save state of the tours (every change is saved automatically by the planning store). Shown
 * in the admin header so a failed save is visible whatever tab the dispatcher is on — drivers
 * work from what the server holds, not from this screen.
 */
export function SyncIndicator() {
  const status = usePlanningStore(s => s.syncStatus)
  const error  = usePlanningStore(s => s.syncError)

  if (status === 'idle') return null
  if (status === 'error') {
    return (
      <span role="alert" title={error ?? undefined}
        className="max-w-[260px] truncate rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">
        Tournées non sauvegardées{error ? ` — ${error}` : ''}
      </span>
    )
  }
  return (
    <span aria-live="polite" className="text-[11px] text-surface-400">
      {status === 'syncing' ? 'Sauvegarde…' : 'Tournées sauvegardées'}
    </span>
  )
}
