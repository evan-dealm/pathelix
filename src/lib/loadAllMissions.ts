import { usePlanningStore } from '@/stores/planningStore'
import type { Mission } from '@/lib/types'

const MAX_PAGES = 50

/**
 * DataProvider only ever loads *today's* missions into the planning store (fast path for
 * the operational planning view). MissionsTab is a full catalog (import/export/archive/kanban,
 * date-range filter) — without this, its date filters silently operate on an array that can
 * never contain anything but today, and opening the tab on a day with 0 missions shows
 * "Aucune mission" even when hundreds exist on other dates. Paginates the full history in once,
 * merging additively (addMissionsBulk only adds unseen ids, so this can't stomp on live status
 * updates to today's missions from the periodic refresh in DataProvider).
 */
export async function loadAllMissionsIntoStore(controller: { cancelled: boolean }): Promise<void> {
  try {
    for (let page = 1; page <= MAX_PAGES && !controller.cancelled; page++) {
      const res = await fetch(`/api/missions?page=${page}&limit=100`, { cache: 'no-store' })
      if (!res.ok) break
      const json = await res.json()
      const data: Mission[] = json?.data ?? []
      if (data.length > 0) usePlanningStore.getState().addMissionsBulk(data)
      if (page >= (json?.totalPages ?? 1)) break
    }
  } catch { /* best-effort — tab still shows whatever today's fast path already loaded */ }
}
