import {
  Mission, MissionType, PlannedMission,
  MISSION_TYPE_LABELS, MISSION_TYPE_ICONS,
} from '@/lib/types'

export type ViewMode = 'day' | 'week' | 'month'
export type AppTab   = 'dashboard' | 'drivers' | 'missions' | 'tours' | 'exutoires' | 'stats' | 'templates' | 'history' | 'vehicles' | 'users' | 'audit' | 'settings' | 'telematics' | 'catalogue' | 'weekly-plan'

export type MissionModalState =
  | { kind: 'none' }
  | { kind: 'new'; date: string }
  | { kind: 'edit'; mission: Mission }
  | { kind: 'edit-planned'; mission: PlannedMission; driverId: string; date: string }

export type ConfirmOverrideState = {
  missionId: string
  driverId: string
  date: string
  algoTimeStr: string
  pendingStartMin: number
} | null

export type TourOverrideState = {
  missionId:    string
  fromDriverId: string
  toDriverId:   string
  date:         string
} | null

export type HistoryEntry = {
  id: string
  label: string
  date: string
  createdAt: string
  snapshot?: Array<{
    driverId: string
    driverName: string
    missionCount: number
    missions: PlannedMission[]
  }>
}

export const TL_START = 5 * 60
export const TL_END   = 22 * 60
export const TL_RANGE = TL_END - TL_START
export const TL_HOURS = Array.from({ length: 18 }, (_, i) => 5 + i)

export const ALL_TYPES = Object.keys(MISSION_TYPE_LABELS) as MissionType[]
export const TYPE_OPTS = ALL_TYPES.map(t => ({
  value: t,
  label: `${MISSION_TYPE_ICONS[t]} ${MISSION_TYPE_LABELS[t]}`,
}))

export const SYNTHETIC_TYPES: MissionType[] = ['VIDER', 'PAUSE']

export const POOL_TYPES = ALL_TYPES.filter(t => !SYNTHETIC_TYPES.includes(t))

export const LEGAL_MAX_DRIVING_MIN = 540
export const LEGAL_MAX_WORK_MIN    = 600

export const BIN_CAPACITIES = ['8m³', '10m³', '15m³', '20m³']

export function mockBinCapacity(driverId: string): string {
  const hash = driverId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return BIN_CAPACITIES[hash % BIN_CAPACITIES.length]
}

export const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
export const WASTE_PRESETS = ['Gravats', 'DIB', 'Bois', 'Ferraille', 'Végétaux', 'Papier carton', 'Gravats marbre']

export const BLANK_DRIVER: Omit<import('@/lib/types').Driver, 'id'> = {
  firstName: '', lastName: '', sector: '', depotName: '',
  depotLat: 45.948, depotLng: 6.147,
}

export const blankMission = (date: string): Omit<Mission, 'id'> => ({
  type: 'POSER', date,
  clientName: '', outletName: '', address: '',
  latitude: 0, longitude: 0,
  estimatedDurationMin: 30, maneuverTimeMin: 15,
  wasteTypeLabel: '', binSize: '', accessNotes: '',
  priority: 2, binSizeM3: undefined, timeWindow: undefined,
})

export const BLANK_EXUTOIRE: Omit<import('@/lib/types').Exutoire, 'id'> = {
  name: '', address: '',
  lat: 45.865, lng: 5.941,
  openingHoursOpen: 420, openingHoursClose: 1080,
  closedDays: [0],
  acceptedWasteTypes: [],
  serviceTimeMin: 20,
}
