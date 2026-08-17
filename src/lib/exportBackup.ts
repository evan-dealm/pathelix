import { usePlanningStore } from '@/stores/planningStore'
import { loadAllMissionsIntoStore } from '@/lib/loadAllMissions'
import { loadPlansForDate } from '@/lib/loadPlansForDate'

export interface BackupExport {
  version: string
  exportedAt: string
  drivers: unknown
  missions: unknown
  plans: unknown
  startTimes: unknown
  speeds: unknown
  unavailable: unknown
  lockedPlans: unknown
}

/**
 * The planning store only ever holds *today's* missions/plans from DataProvider's initial
 * load, plus whatever partial history other tabs happened to pull in this session — the
 * "Exporter JSON" backup button used to read straight from that store, silently producing a
 * backup file missing most historical/future missions and plans, with no indication it was
 * incomplete. Loads the full mission history, then every date that has at least one mission,
 * before reading fresh state to export (no API exists to fetch "all plans" in one call, so a
 * date with a plan but zero surviving missions — unusual — still won't be captured).
 */
export async function buildBackupExport(): Promise<BackupExport> {
  const controller = { cancelled: false }
  await loadAllMissionsIntoStore(controller)
  const missionDates = [...new Set(usePlanningStore.getState().missions.map((m: { date: string }) => m.date))]
  await Promise.all(missionDates.map(d => loadPlansForDate(d)))

  const state = usePlanningStore.getState()
  return {
    version:    '1.0',
    exportedAt: new Date().toISOString(),
    drivers:    state.drivers,
    missions:   state.missions,
    plans:      state.plans,
    startTimes: state.startTimes,
    speeds:     state.speeds,
    unavailable: state.unavailable,
    lockedPlans: state.lockedPlans,
  }
}
