import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { apiErrorMessage } from '@/lib/apiClient'
import type { Driver, Mission, PlannedMission } from '@/lib/types'
import { idbStorage } from '@/lib/idbStorage'
import { createLogger } from '@/lib/logger'

const log = createLogger('planningStore')

type HistorySnapshot = {
  plans:      Record<string, PlannedMission[]>
  startTimes: Record<string, string>
}

type SyncStatus = 'idle' | 'syncing' | 'error' | 'synced'

interface PlanningState {
  drivers:     Driver[]
  missions:    Mission[]

  plans:       Record<string, PlannedMission[]>

  startTimes:  Record<string, string>

  speeds:      Record<string, number>

  unavailable: Record<string, boolean>

  lockedPlans: Record<string, boolean>

  syncStatus:    SyncStatus
  /** Why the last tour save failed (shown to the dispatcher), null otherwise. */
  syncError:     string | null
  lastSyncedAt:  string | null

  _history:    HistorySnapshot[]
  /** Number of undo steps taken since the last action (0 = at the live tip). */
  _historyIdx: number
  /** Live state captured lazily on the first undo since the last action, so redo can return to it — `_history` only ever stores pre-action snapshots, never the tip itself. */
  _tip:        HistorySnapshot | null
}

interface PlanningActions {

  setInitialData(_drivers: Driver[], _missions: Mission[]): void
  addMissionsBulk(_missions: Mission[]): void
  upsertMissions(_missions: Mission[]): void
  mergePlansFromDB(_plans: Array<{
    driverId:   string
    date:       string
    missions:   PlannedMission[]
    startTime?: string
    speedKmh?:  number
  }>): void

  addMission(_data: Omit<Mission, 'id'>, _serverId?: string): void
  updateMission(_id: string, _data: Partial<Mission>): void
  removeMission(_id: string): void
  archiveMission(_id: string): void
  restoreMission(_id: string): void

  addDriver(_data: Omit<Driver, 'id'>, _serverId?: string): void
  updateDriver(_id: string, _data: Partial<Driver>): void
  removeDriver(_id: string): void
  archiveDriver(_id: string): void
  restoreDriver(_id: string): void
  addDriversBulk(_drivers: Array<Omit<Driver, 'id'>>): void

  assignToDriver(_missionId: string, _driverId: string, _date: string): void
  unassignFromDriver(_missionId: string, _driverId: string, _date: string): void
  clearDriverPlan(_driverId: string, _date: string): void
  clearAllPlansForDate(_date: string): void
  applyOptimization(
    _date:        string,
    _assignments: Record<string, PlannedMission[]>,
    _unassigned:  Mission[],
    _defaultStartTime?: string,
  ): void
  moveUp(_missionId: string, _driverId: string, _date: string): void
  moveDown(_missionId: string, _driverId: string, _date: string): void
  reorderMissions(_driverId: string, _date: string, _fromIndex: number, _toIndex: number): void

  setStartTime(_driverId: string, _date: string, _time: string): void
  setSpeed(_driverId: string, _speed: number): void
  toggleUnavailable(_driverId: string, _date: string): void
  isUnavailable(_driverId: string, _date: string): boolean
  togglePlanLock(_driverId: string, _date: string): void
  isPlanLocked(_driverId: string, _date: string): boolean
  copyPlansToDate(_fromDate: string, _toDate: string): void

  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean

  updatePlannedMission(_missionId: string, _driverId: string, _date: string, _data: Partial<PlannedMission>): void
  setManualStartMin(_missionId: string, _driverId: string, _date: string, _startMin: number | undefined): void

}

type PlanningStore = PlanningState & PlanningActions

function planKey(driverId: string, date: string): string {
  return `${driverId}|${date}`
}

function genId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const MAX_HISTORY = 20

function pushHistory(state: PlanningState, snap: HistorySnapshot): Partial<PlanningState> {
  // _historyIdx counts undo steps taken since the last action: any state reachable
  // only via a now-abandoned redo branch (indices beyond the current position) is
  // dropped, then the new pre-action snapshot is appended.
  const keepUpTo = state._history.length - state._historyIdx
  const base = state._history.slice(0, keepUpTo)
  const next = [...base, snap].slice(-MAX_HISTORY)
  return {
    _history:    next,
    _historyIdx: 0,
    _tip:        null,
  }
}

const _syncTimers = new Map<string, ReturnType<typeof setTimeout>>()
const _syncAllTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function _cleanupTimers() {
  for (const timer of _syncTimers.values()) clearTimeout(timer)
  _syncTimers.clear()
  for (const timer of _syncAllTimers.values()) clearTimeout(timer)
  _syncAllTimers.clear()
}

function debouncedSyncPlan(
  driverId: string,
  date: string,
  get: () => PlanningStore,
  set: (_partial: Partial<PlanningState> | ((_state: PlanningStore) => Partial<PlanningState>)) => void,
) {

  if (typeof window === 'undefined') return
  const timerKey = `${driverId}|${date}`
  const existing = _syncTimers.get(timerKey)
  if (existing) clearTimeout(existing)
  _syncTimers.set(timerKey, setTimeout(async () => {
    _syncTimers.delete(timerKey)
    const state = get()
    const key = `${driverId}|${date}`
    const missions = state.plans[key] || []
    const startTime = state.startTimes[key] || '07:00'
    const speed = state.speeds[driverId] || 50

    try {
      set({ syncStatus: 'syncing', syncError: null })
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId, date, missions, startTime, speedKmh: speed }),
      })
      if (!res.ok) throw new Error(apiErrorMessage(await res.json().catch(() => null), res.status))
      set({ syncStatus: 'synced', lastSyncedAt: new Date().toISOString() })
    } catch (err) {
      log.warn('sync failed', { err: err instanceof Error ? err.message : String(err) })
      set({ syncStatus: 'error', syncError: err instanceof Error ? err.message : 'Sauvegarde impossible' })
    }
  }, 500))
}

function debouncedSyncAllForDate(
  date: string,
  get: () => PlanningStore,
  set: (_partial: Partial<PlanningState> | ((_state: PlanningStore) => Partial<PlanningState>)) => void,
  delayMs = 500,
) {

  if (typeof window === 'undefined') return
  // One timer per date: syncing several dates at once (undo across days, copy to another day)
  // must not cancel each other.
  const pending = _syncAllTimers.get(date)
  if (pending) clearTimeout(pending)
  _syncAllTimers.set(date, setTimeout(async () => {
    _syncAllTimers.delete(date)
    const state = get()
    const plansForDate: Array<{
      driverId: string; date: string; missions: PlannedMission[];
      startTime: string; speedKmh: number
    }> = []

    for (const [key, missions] of Object.entries(state.plans)) {
      if (!key.endsWith(`|${date}`)) continue
      const dId = key.replace(`|${date}`, '')
      plansForDate.push({
        driverId: dId, date, missions,
        startTime: state.startTimes[key] ?? '07:00',
        speedKmh: state.speeds[dId] ?? 50,
      })
    }

    if (plansForDate.length === 0) return

    try {
      set({ syncStatus: 'syncing', syncError: null })

      const BATCH = 50
      const batches = []
      for (let i = 0; i < plansForDate.length; i += BATCH) {
        batches.push(plansForDate.slice(i, i + BATCH))
      }
      const results = await Promise.all(batches.map(batch => {
        const body = JSON.stringify(batch)
        return fetch('/api/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          // Lets the save finish if the page is left right away (browsers cap keepalive bodies at 64 KB).
          keepalive: body.length < 60_000,
        })
      }))
      const failed = results.find(r => !r.ok)
      if (failed) throw new Error(apiErrorMessage(await failed.json().catch(() => null), failed.status))
      set({ syncStatus: 'synced', lastSyncedAt: new Date().toISOString() })
    } catch (err) {
      log.warn('sync (all for date) failed', { err: err instanceof Error ? err.message : String(err) })
      set({ syncStatus: 'error', syncError: err instanceof Error ? err.message : 'Sauvegarde impossible' })
    }
  }, delayMs))
}

/** Saves every date whose tours differ between two plan maps (undo/redo, copy, archive…). */
function syncChangedDates(
  before: Record<string, PlannedMission[]>,
  get: () => PlanningStore,
  set: (_partial: Partial<PlanningState> | ((_state: PlanningStore) => Partial<PlanningState>)) => void,
) {
  const after = get().plans
  const dates = new Set<string>()
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) dates.add(key.split('|')[1] ?? '')
  }
  for (const date of dates) if (date) debouncedSyncAllForDate(date, get, set)
}

export const usePlanningStore = create<PlanningStore>()(
  persist(
    (set, get) => ({

      drivers:     [],
      missions:    [],
      plans:       {},
      startTimes:  {},
      speeds:      {},
      unavailable: {},
      lockedPlans: {},
      syncStatus:    'idle',
      syncError:     null,
      lastSyncedAt:  null,
      _history:    [],
      _historyIdx: 0,
      _tip:        null,

      setInitialData(drivers, missions) {
        set({ drivers, missions })
      },

      addMissionsBulk(newMissions: Mission[]) {
        set(state => {
          const existingIds = new Set(state.missions.map(m => m.id))
          const toAdd = newMissions.filter(m => !existingIds.has(m.id))
          if (toAdd.length === 0) return {}
          return { missions: [...state.missions, ...toAdd] }
        })
      },

      // Unlike setInitialData (full replace) or addMissionsBulk (add-only), this updates
      // missions already in the store in place and adds any new ones — needed so the
      // periodic "today" refresh in DataProvider can push live status changes without
      // wiping out other dates' missions that were separately loaded (e.g. by the Missions
      // tab's full-history preload), which a full `set({ missions })` replace would erase.
      upsertMissions(incoming: Mission[]) {
        set(state => {
          const byId = new Map(state.missions.map(m => [m.id, m]))
          for (const m of incoming) byId.set(m.id, m)
          return { missions: [...byId.values()] }
        })
      },

      mergePlansFromDB(dbPlans) {
        set(state => {
          const plans      = { ...state.plans }
          const startTimes = { ...state.startTimes }
          const speeds     = { ...state.speeds }

          for (const p of dbPlans) {
            plans[planKey(p.driverId, p.date)] = p.missions
            if (p.startTime) startTimes[planKey(p.driverId, p.date)] = p.startTime
            if (p.speedKmh)  speeds[p.driverId]                      = p.speedKmh
          }

          return { plans, startTimes, speeds }
        })
      },

      addMission(data, serverId) {
        const id = serverId ?? genId()
        set(state => ({ missions: [...state.missions, { ...data, id }] }))
      },

      updateMission(id, data) {
        set(state => {

          const newPlans = { ...state.plans }
          let changed = false
          for (const k in newPlans) {
            const ms = newPlans[k]
            if (ms.some(m => m.id === id)) {
              newPlans[k] = ms.map(m => m.id === id ? { ...m, ...data } : m)
              changed = true
            }
          }
          return {
            missions: state.missions.map(m => m.id === id ? { ...m, ...data } : m),
            ...(changed ? { plans: newPlans } : {}),
          }
        })
      },

      removeMission(id) {
        const before = get().plans
        set(state => {
          const newPlans = { ...state.plans }
          let changed = false
          for (const k in newPlans) {
            const ms = newPlans[k]
            if (ms.some(m => m.id === id)) {
              newPlans[k] = ms.filter(m => m.id !== id)
              changed = true
            }
          }
          return {
            missions: state.missions.filter(m => m.id !== id),
            ...(changed ? { plans: newPlans } : {}),
          }
        })
        syncChangedDates(before, get, set)
      },

      archiveMission(id) {
        const before = get().plans
        set(state => {
          const newPlans = { ...state.plans }
          let changed = false
          for (const k in newPlans) {
            const ms = newPlans[k]
            if (ms.some(m => m.id === id)) {
              newPlans[k] = ms.filter(m => m.id !== id)
              changed = true
            }
          }
          return {
            missions: state.missions.map(m => m.id === id ? { ...m, archived: true } : m),
            ...(changed ? { plans: newPlans } : {}),
          }
        })
        syncChangedDates(before, get, set)
      },

      restoreMission(id) {
        set(state => ({
          missions: state.missions.map(m => m.id === id ? { ...m, archived: false } : m),
        }))
      },

      addDriver(data, serverId) {
        const id = serverId ?? genId()
        set(state => ({ drivers: [...state.drivers, { ...data, id }] }))
      },

      updateDriver(id, data) {
        set(state => ({
          drivers: state.drivers.map(d => d.id === id ? { ...d, ...data } : d),
        }))
      },

      removeDriver(id) {
        set(state => {
          const plans = { ...state.plans }
          const startTimes = { ...state.startTimes }
          const speeds = { ...state.speeds }
          for (const key of Object.keys(plans)) {
            if (key.startsWith(id + '|')) { delete plans[key]; delete startTimes[key]; delete speeds[key] }
          }
          return { drivers: state.drivers.filter(d => d.id !== id), plans, startTimes, speeds }
        })
      },

      archiveDriver(id) {
        set(state => ({
          drivers: state.drivers.map(d => d.id === id ? { ...d, archived: true } : d),
        }))
      },

      restoreDriver(id) {
        set(state => ({
          drivers: state.drivers.map(d => d.id === id ? { ...d, archived: false } : d),
        }))
      },

      addDriversBulk(newDrivers) {
        set(state => ({
          drivers: [
            ...state.drivers,
            ...newDrivers.map(d => ({ ...d, id: genId() })),
          ],
        }))
      },

      assignToDriver(missionId, driverId, date) {
        if (get().lockedPlans[`${driverId}|${date}`]) return
        set(state => {
          const mission = state.missions.find(m => m.id === missionId)
          if (!mission) return {}

          const key0 = planKey(driverId, date)
          if ((state.plans[key0] ?? []).some(m => m.id === missionId)) return {}

          const key          = planKey(driverId, date)
          const existing     = state.plans[key] ?? []
          const sequenceOrder = existing.length + 1

          const planned: PlannedMission = {
            ...mission,
            date,
            sequenceOrder,
          }

          const snap: HistorySnapshot = { plans: state.plans, startTimes: state.startTimes }

          return {
            plans: { ...state.plans, [key]: [...existing, planned] },
            ...pushHistory(state, snap),
          }
        })
        debouncedSyncPlan(driverId, date, get, set)
      },

      unassignFromDriver(missionId, driverId, date) {
        if (get().lockedPlans[`${driverId}|${date}`]) return
        set(state => {
          const key     = planKey(driverId, date)
          const updated = (state.plans[key] ?? [])
            .filter(m => m.id !== missionId)
            .map((m, i) => ({ ...m, sequenceOrder: i + 1 }))

          const snap: HistorySnapshot = { plans: state.plans, startTimes: state.startTimes }

          return {
            plans: { ...state.plans, [key]: updated },
            ...pushHistory(state, snap),
          }
        })
        debouncedSyncPlan(driverId, date, get, set)
      },

      clearDriverPlan(driverId, date) {
        if (get().lockedPlans[`${driverId}|${date}`]) return
        set(state => {
          const key  = planKey(driverId, date)
          const snap: HistorySnapshot = { plans: state.plans, startTimes: state.startTimes }

          const existingIds = new Set(state.missions.map(m => m.id))
          const toRestore = (state.plans[key] ?? [])
            .filter(pm => !pm.isSynthetic && !existingIds.has(pm.id))
            .map(pm => pm as unknown as Mission)

          return {
            plans: { ...state.plans, [key]: [] },
            missions: toRestore.length > 0 ? [...state.missions, ...toRestore] : state.missions,
            ...pushHistory(state, snap),
          }
        })
        debouncedSyncPlan(driverId, date, get, set)
      },

      clearAllPlansForDate(date) {
        set(state => {
          const snap: HistorySnapshot = { plans: state.plans, startTimes: state.startTimes }

          const existingIds = new Set(state.missions.map(m => m.id))
          const toRestore: Mission[] = []
          const updated = Object.fromEntries(
            Object.entries(state.plans).map(([k, v]) => {
              if (!k.endsWith(`|${date}`)) return [k, v]
              for (const pm of v) {
                if (!pm.isSynthetic && !existingIds.has(pm.id)) {
                  toRestore.push(pm as unknown as Mission)
                  existingIds.add(pm.id)
                }
              }
              return [k, []]
            }),
          )
          return {
            plans: updated,
            missions: toRestore.length > 0 ? [...state.missions, ...toRestore] : state.missions,
            ...pushHistory(state, snap),
          }
        })
        debouncedSyncAllForDate(date, get, set)
      },

      applyOptimization(date, assignments, unassigned, defaultStartTime) {
        set(state => {
          const snap: HistorySnapshot = { plans: state.plans, startTimes: state.startTimes }
          const updatedPlans = { ...state.plans }

          const updatedStartTimes = { ...state.startTimes }
          if (defaultStartTime) {
            for (const driverId of Object.keys(assignments)) {
              const key = `${driverId}|${date}`
              updatedStartTimes[key] = defaultStartTime
            }
          }

          for (const [driverId, plannedMissions] of Object.entries(assignments)) {
            updatedPlans[planKey(driverId, date)] = plannedMissions
          }

          const assignedIds = new Set<string>()
          for (const plannedMissions of Object.values(assignments)) {
            for (const m of plannedMissions) {
              if (!m.isSynthetic) assignedIds.add(m.id)
            }
          }
          // A driver who got nothing this time (left out, on leave, truck down) must not keep a
          // mission the optimiser just gave to someone else or returned as unassigned.
          const movedIds = new Set([...assignedIds, ...unassigned.map(m => m.id)])
          const suffix = `|${date}`
          for (const key of Object.keys(updatedPlans)) {
            if (!key.endsWith(suffix) || assignments[key.slice(0, -suffix.length)]) continue
            const kept = updatedPlans[key].filter(m => !movedIds.has(m.id))
            if (kept.length !== updatedPlans[key].length) {
              updatedPlans[key] = kept.some(m => !m.isSynthetic) ? kept : []
            }
          }

          const existingIds = new Set(state.missions.map(m => m.id))
          const toAdd       = unassigned.filter(m => !existingIds.has(m.id))

          const missionsChanged = toAdd.length > 0 || state.missions.some(m => assignedIds.has(m.id))
          const newMissions = missionsChanged
            ? [...state.missions.filter(m => !assignedIds.has(m.id)), ...toAdd]
            : state.missions

          return {
            plans:      updatedPlans,
            startTimes: updatedStartTimes,
            missions:   newMissions,
            ...pushHistory(state, snap),
          }
        })
        // Saved at once, not after the usual pause for drag-and-drop bursts: a dispatcher who
        // optimises and leaves the page straight away must find the routes on return.
        debouncedSyncAllForDate(date, get, set, 0)
      },

      moveUp(missionId, driverId, date) {
        if (get().lockedPlans[`${driverId}|${date}`]) return
        set(state => {
          const key  = planKey(driverId, date)
          const list = (state.plans[key] ?? []).slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder)
          const idx  = list.findIndex(m => m.id === missionId)
          if (idx <= 0) return {}

          const snap: HistorySnapshot = { plans: state.plans, startTimes: state.startTimes }

          const prev = list[idx - 1]
          const curr = list[idx]
          list[idx - 1] = { ...curr, sequenceOrder: prev.sequenceOrder }
          list[idx]     = { ...prev, sequenceOrder: curr.sequenceOrder }

          return {
            plans: { ...state.plans, [key]: list },
            ...pushHistory(state, snap),
          }
        })
        debouncedSyncPlan(driverId, date, get, set)
      },

      moveDown(missionId, driverId, date) {
        if (get().lockedPlans[`${driverId}|${date}`]) return
        set(state => {
          const key  = planKey(driverId, date)
          const list = (state.plans[key] ?? []).slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder)
          const idx  = list.findIndex(m => m.id === missionId)
          if (idx < 0 || idx >= list.length - 1) return {}

          const snap: HistorySnapshot = { plans: state.plans, startTimes: state.startTimes }

          const next = list[idx + 1]
          const curr = list[idx]
          list[idx + 1] = { ...curr, sequenceOrder: next.sequenceOrder }
          list[idx]     = { ...next, sequenceOrder: curr.sequenceOrder }

          return {
            plans: { ...state.plans, [key]: list },
            ...pushHistory(state, snap),
          }
        })
        debouncedSyncPlan(driverId, date, get, set)
      },

      reorderMissions(driverId, date, fromIndex, toIndex) {
        if (get().lockedPlans[`${driverId}|${date}`]) return
        if (fromIndex === toIndex) return
        set(state => {
          const key  = planKey(driverId, date)
          const list = (state.plans[key] ?? []).slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder)
          if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return {}

          const snap: HistorySnapshot = { plans: state.plans, startTimes: state.startTimes }

          const [moved] = list.splice(fromIndex, 1)
          list.splice(toIndex, 0, moved)

          const reordered = list.map((m, i) => ({ ...m, sequenceOrder: i + 1 }))

          return {
            plans: { ...state.plans, [key]: reordered },
            ...pushHistory(state, snap),
          }
        })
        debouncedSyncPlan(driverId, date, get, set)
      },

      setStartTime(driverId, date, time) {
        set(state => ({
          startTimes: { ...state.startTimes, [planKey(driverId, date)]: time },
        }))
        debouncedSyncPlan(driverId, date, get, set)
      },

      setSpeed(driverId, speed) {
        set(state => ({
          speeds: { ...state.speeds, [driverId]: speed },
        }))
      },

      toggleUnavailable(driverId, date) {
        set(state => {
          const key  = planKey(driverId, date)
          const prev = state.unavailable[key] ?? false
          return { unavailable: { ...state.unavailable, [key]: !prev } }
        })
      },

      isUnavailable(driverId, date) {
        return get().unavailable[planKey(driverId, date)] ?? false
      },

      togglePlanLock(driverId, date) {
        set(state => {
          const key = `${driverId}|${date}`
          return { lockedPlans: { ...state.lockedPlans, [key]: !state.lockedPlans[key] } }
        })
      },

      isPlanLocked(driverId, date) {
        return get().lockedPlans[`${driverId}|${date}`] || false
      },

      copyPlansToDate(fromDate, toDate) {
        const before = get().plans
        set(state => {
          const newPlans = { ...state.plans }
          const newStartTimes = { ...state.startTimes }
          for (const [key, plan] of Object.entries(state.plans)) {
            if (!key.endsWith(`|${fromDate}`)) continue
            const driverId = key.split('|')[0]
            const targetKey = `${driverId}|${toDate}`
            if (state.lockedPlans[targetKey]) continue

            newPlans[targetKey] = plan.map(m => ({
              ...m,
              timeWindow: m.timeWindow ? { ...m.timeWindow } : undefined,
            }))
            if (state.startTimes[key]) {
              newStartTimes[targetKey] = state.startTimes[key]
            }
          }
          return { plans: newPlans, startTimes: newStartTimes }
        })
        syncChangedDates(before, get, set)
      },

      undo() {
        const before = get().plans
        set(state => {
          const n = state._history.length
          if (state._historyIdx >= n) return {}
          // Capture the live state on the first undo since the last action, so
          // redo can eventually return to it — it is never stored in _history.
          const tip = state._historyIdx === 0
            ? { plans: state.plans, startTimes: state.startTimes }
            : state._tip
          const newIdx = state._historyIdx + 1
          const snap   = state._history[n - newIdx]
          return {
            plans:       snap.plans,
            startTimes:  snap.startTimes,
            _historyIdx: newIdx,
            _tip:        tip,
          }
        })
        syncChangedDates(before, get, set)
      },

      redo() {
        const before = get().plans
        set(state => {
          if (state._historyIdx <= 0) return {}
          const newIdx = state._historyIdx - 1
          if (newIdx === 0) {
            if (!state._tip) return {}
            return {
              plans:       state._tip.plans,
              startTimes:  state._tip.startTimes,
              _historyIdx: 0,
            }
          }
          const n    = state._history.length
          const snap = state._history[n - newIdx]
          return {
            plans:       snap.plans,
            startTimes:  snap.startTimes,
            _historyIdx: newIdx,
          }
        })
        syncChangedDates(before, get, set)
      },

      canUndo() {
        const state = get()
        return state._historyIdx < state._history.length
      },

      canRedo() {
        return get()._historyIdx > 0
      },

      updatePlannedMission(missionId, driverId, date, data) {
        const key = planKey(driverId, date)
        set(state => {
          const list = state.plans[key]
          if (!list) return {}
          const idx = list.findIndex(m => m.id === missionId)
          if (idx === -1) return {}
          const updated = list.map((m, i) => i === idx ? { ...m, ...data } : m)
          return {
            plans: { ...state.plans, [key]: updated },
            ...pushHistory(state, { plans: state.plans, startTimes: state.startTimes }),
          }
        })
        debouncedSyncPlan(driverId, date, get, set)
      },

      setManualStartMin(missionId, driverId, date, startMin) {
        const key = planKey(driverId, date)
        set(state => {
          const list = state.plans[key]
          if (!list) return {}
          const updated = list.map(m =>
            m.id === missionId ? { ...m, manualStartMin: startMin } : m,
          )
          return { plans: { ...state.plans, [key]: updated } }
        })
        debouncedSyncPlan(driverId, date, get, set)
      },

    }),

    {
      name:    'pathelix-planning-store',
      version: 2,

      storage: createJSONStorage(() => idbStorage),

      migrate: () => ({
        drivers: [], missions: [], plans: {}, startTimes: {},
        speeds: {}, unavailable: {}, lockedPlans: {},
      }),

      partialize: (state) => {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 7)
        const cutoffStr = cutoff.toISOString().split('T')[0]

        const filteredPlans: Record<string, PlannedMission[]> = {}
        const filteredStartTimes: Record<string, string> = {}
        const filteredUnavailable: Record<string, boolean> = {}
        const filteredLockedPlans: Record<string, boolean> = {}

        for (const [key, val] of Object.entries(state.plans)) {
          const date = key.split('|')[1] ?? ''
          if (date >= cutoffStr) filteredPlans[key] = val
        }
        for (const [key, val] of Object.entries(state.startTimes)) {
          const date = key.split('|')[1] ?? ''
          if (date >= cutoffStr) filteredStartTimes[key] = val
        }
        for (const [key, val] of Object.entries(state.unavailable)) {
          const date = key.split('|')[1] ?? ''
          if (date >= cutoffStr) filteredUnavailable[key] = val
        }
        for (const [key, val] of Object.entries(state.lockedPlans)) {
          const date = key.split('|')[1] ?? ''
          if (date >= cutoffStr) filteredLockedPlans[key] = val
        }

        return {

          plans:       filteredPlans,
          startTimes:  filteredStartTimes,
          speeds:      state.speeds,
          unavailable: filteredUnavailable,
          lockedPlans: filteredLockedPlans,
        }
      },

      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<typeof current>
        return {
          ...current,
          ...p,
          drivers:     Array.isArray(p.drivers)     ? p.drivers     : [],
          missions:    Array.isArray(p.missions)    ? p.missions    : [],
          plans:       (p.plans       && typeof p.plans       === 'object') ? p.plans       : {},
          startTimes:  (p.startTimes  && typeof p.startTimes  === 'object') ? p.startTimes  : {},
          speeds:      (p.speeds      && typeof p.speeds      === 'object') ? p.speeds      : {},
          unavailable: (p.unavailable && typeof p.unavailable === 'object') ? p.unavailable : {},
          lockedPlans: (p.lockedPlans && typeof p.lockedPlans === 'object') ? p.lockedPlans : {},
        }
      },
    },
  ),
)
