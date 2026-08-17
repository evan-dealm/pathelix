import { usePlanningStore } from '@/stores/planningStore'

type DBPlan = Parameters<ReturnType<typeof usePlanningStore.getState>['mergePlansFromDB']>[0][number]

/**
 * DataProvider only ever loads *today's* plans into the store (fast path for the operational
 * planning view). ToursTab lets the user navigate to any date via Jour precedent/suivant, but
 * nothing fetched that date's plans — storePlans[`${driverId}|${otherDate}`] was always empty,
 * so every date but today showed "Aucune tournée planifiée" regardless of what actually existed
 * in the DB. Call this whenever the tab's selected date changes.
 */
export async function loadPlansForDate(date: string): Promise<void> {
  try {
    const res = await fetch(`/api/plans?date=${date}`, { cache: 'no-store' })
    if (!res.ok) return
    const data: unknown = await res.json()
    const plans = Array.isArray(data) ? data : (data as { data?: unknown[] })?.data
    if (plans && plans.length > 0) {
      usePlanningStore.getState().mergePlansFromDB(plans as DBPlan[])
    }
  } catch { /* best-effort — tab still shows whatever's already in the store */ }
}
