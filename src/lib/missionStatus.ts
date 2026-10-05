/**
 * Field progression of a mission, as reported by the driver app and stored per mission in
 * `Plan.statuses`. Single source for the client flow and the server validation — the two used to
 * diverge (`doing` was sent by the app but rejected by the API, so that step was never saved).
 */
export const MISSION_STATUSES = ['todo', 'en_route', 'arrived', 'started', 'doing', 'done'] as const

export type MissionStatus = typeof MISSION_STATUSES[number]

export function isMissionStatus(v: unknown): v is MissionStatus {
  return typeof v === 'string' && (MISSION_STATUSES as readonly string[]).includes(v)
}

/** Next step of the flow, or null once the mission is done. */
export function nextMissionStatus(current: MissionStatus): MissionStatus | null {
  const i = MISSION_STATUSES.indexOf(current)
  return i >= 0 && i < MISSION_STATUSES.length - 1 ? MISSION_STATUSES[i + 1] : null
}
