export type MissionType = 'POSER' | 'RETIRER' | 'ECHANGER' | 'VIDER' | 'PAUSE' | 'CHARGER_IMMEDIAT' | 'DEPLACER' | 'TASSER' | 'EXPEDIER' | 'ALLER_RETOUR'

export interface TimeWindow {
  openMin:  number
  closeMin: number
}

export interface Mission {
  id:                   string
  type:                 MissionType
  date:                 string
  clientName?:          string
  outletName?:          string
  address:              string
  latitude:             number
  longitude:            number
  estimatedDurationMin: number
  maneuverTimeMin:      number
  wasteTypeLabel?:      string
  binSize?:             string
  binSizeM3?:           number
  accessNotes?:         string
  priority?:            1 | 2 | 3
  timeWindow?:          TimeWindow
  linkedExutoireId?:    string
  archived?:            boolean
  tags?:                string[]
  notes?:               string
  dependsOnId?:         string
  attachments?:         { name: string; url: string; type: string }[]

  clientId?:            string
  siteId?:              string
  productId?:           string

  voucherDelivered?:    boolean
  equipmentType?:       string

  requiredSkills?:      string[]

  externalRef?:         string

  needsGeocode?:        boolean

  actualDurationMin?:   number
  actualDistanceKm?:    number
  completedAt?:         string
  cancelledAt?:         string
  cancelReason?:        string
  driverComment?:       string
  signatureUrl?:        string
}

export interface CatalogClient {
  id:              string
  name:            string
  contact:         string
  phone:           string
  email:           string
  vip:             boolean
  requiresDeposit: boolean
  ecoResponsable:  boolean
  requiresBsd:     boolean
  voucherRequired: boolean
  notes:           string
  archived?:       boolean
  clientSites?:    { site: { id: string; name: string; address: string; latitude: number; longitude: number; accessNotes: string; defaultManeuverMin: number } }[]
  _count?:         { siteProducts: number; missions: number }

  siret?:            string
  billingAddress?:   string
  externalRef?:      string
  sector?:           string
  contractStart?:    string | null
  contractEnd?:      string | null
  paymentTermsDays?: number
}

export interface CatalogSite {
  id:                 string
  name:               string
  address:            string
  latitude:           number
  longitude:          number
  accessNotes:        string
  defaultManeuverMin: number
  sector:             string
  city:               string
  zipCode:            string
  country:            string
  siteType:           string
  openingHoursOpen?:  number | null
  openingHoursClose?: number | null
  archived?:          boolean
  clientSites?:       { client: { id: string; name: string } }[]
}

export interface CatalogProduct {
  id:                 string
  siteId:             string
  clientId:           string
  wasteType:          string
  binSizeLabel:       string
  binSizeM3?:         number | null
  equipmentType:      string
  defaultDurationMin: number
  defaultExutoireId?: string | null
  notes:              string
  archived?:          boolean
  site?:              { id: string; name: string; address: string; latitude: number; longitude: number; accessNotes: string; defaultManeuverMin: number }
  client?:            { id: string; name: string; vip: boolean; requiresBsd: boolean; voucherRequired: boolean }
  defaultExutoire?:   { id: string; name: string } | null
}

export interface PlannedMission extends Mission {
  sequenceOrder:         number
  isSynthetic?:          boolean
  manualStartMin?:       number
  precomputedTravelMin?: number
}

export interface Driver {
  id:               string
  firstName:        string
  lastName:         string
  sector:           string
  depotName:        string
  depotLat:         number
  depotLng:         number
  maxBinSizeM3?:    number
  vehicleCapacity?: number

  capacityDimensions?: {
    poids?:    number
    volume?:   number
    nbBennes?: number
  }
  archived?:        boolean
  notes?:           string
  skills?:          string[]
  weeklyHoursMax?:  number
  phone?:           string

  vehicleDimensions?: VehicleDimensions

  email?:             string
  employeeNumber?:    string
  hiredAt?:           string | null
  birthDate?:         string | null
  licenseExpiry?:     string | null
  licenseCategories?: string[]
  emergencyContact?:  string
  color?:             string
  startingExutoireId?: string | null
}

export interface Exutoire {
  id:                  string
  name:                string
  address:             string
  lat:                 number
  lng:                 number
  openingHoursOpen:    number
  openingHoursClose:   number
  closedDays:          number[]
  acceptedWasteTypes:  string[]
  serviceTimeMin:      number
}

export interface Vehicle {
  id:                string
  licensePlate:      string
  type:              string
  brand:             string
  model:             string
  capacityM3?:       number
  maxBins?:          number
  mileageKm:         number
  nextInspection?:   string
  status:            'active' | 'maintenance' | 'decommissioned'
  notes:             string
  assignedDriverId?: string
  archived?:         boolean

  gabaritProfile?:   string
  weightTon:         number
  heightM:           number
  widthM:            number
  lengthM:           number
  axleCount:         number
  hazmat:            boolean

  tollClass?:        number
  telepayBadge?:     string
  telepayDiscount?:  number
}

export interface VehicleDimensions {
  weightTon: number
  heightM:   number
  widthM:    number
  lengthM:   number
  axleCount: number
  hazmat:    boolean
}

export interface Holiday {
  id:        string
  date:      string
  label:     string
  recurring: boolean
}

export interface TenantSettings {
  id:                  string
  defaultSpeedKmh:     number
  defaultStartTime:    string
  maxWorkDayMin:       number
  pauseAfterMin:       number
  pauseDurationMin:    number
  costPerKm:           number
  fuelCostPerLiter:    number
  consumptionLPer100:  number
  primaryColor:        string
  logoUrl:             string
  companyDisplayName:  string
}

export interface SettingsApiResponse {
  defaultSpeedKmh?:        number
  defaultStartTime?:       string
  maxWorkDayMin?:          number
  pauseAfterMin?:          number
  pauseDurationMin?:       number
  costPerKm?:              number
  fuelCostPerLiter?:       number
  consumptionLPer100?:     number
  valhallaFactor?:         number
  primaryColor?:           string
  companyDisplayName?:     string
  logoUrl?:                string
  timezone?:               string
  locale?:                 string
  notificationsEnabled?:   boolean
  smsEnabled?:             boolean
  emailEnabled?:           boolean
  invoicePrefix?:          string
  vatNumber?:              string
  billingEmail?:           string
  supportEmail?:           string
  maxOptimizationsPerDay?: number
  trade?:                  string
  routingSource?:          string
}

export interface DriverUnavailability {
  id:        string
  driverId:  string
  startDate: string
  endDate:   string
  reason:    'conge' | 'maladie' | 'formation' | 'autre'
  notes:     string
}

export const MISSION_TYPE_LABELS: Record<MissionType, string> = {
  POSER:            'Pose',
  RETIRER:          'Enlèvement',
  ECHANGER:         'Rotation',
  VIDER:            'Vidage',
  PAUSE:            'Pause',
  CHARGER_IMMEDIAT: 'Ch. immédiat',
  DEPLACER:         'Déplacement',
  TASSER:           'Tassage',
  EXPEDIER:         'Expédition',
  ALLER_RETOUR:     'Aller-Retour',
}

export const MISSION_TYPE_ICONS: Record<MissionType, string> = {
  POSER:            '📦',
  RETIRER:          '🔴',
  ECHANGER:         '🔄',
  VIDER:            '🏭',
  PAUSE:            '⏸️',
  CHARGER_IMMEDIAT: '⚡',
  DEPLACER:         '🚚',
  TASSER:           '🔨',
  EXPEDIER:         '📤',
  ALLER_RETOUR:     '↩️',
}

export const MISSION_TYPE_COLORS: Record<MissionType, string> = {
  POSER:            'bg-blue-50 text-blue-700 border-blue-200',
  RETIRER:          'bg-red-50 text-red-700 border-red-200',
  ECHANGER:         'bg-amber-50 text-amber-700 border-amber-200',
  VIDER:            'bg-violet-50 text-violet-700 border-violet-200',
  PAUSE:            'bg-surface-100 text-surface-500 border-surface-200',
  CHARGER_IMMEDIAT: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  DEPLACER:         'bg-cyan-50 text-cyan-700 border-cyan-200',
  TASSER:           'bg-orange-50 text-orange-700 border-orange-200',
  EXPEDIER:         'bg-emerald-50 text-emerald-700 border-emerald-200',
  ALLER_RETOUR:     'bg-teal-50 text-teal-700 border-teal-200',
}

export const MISSION_TYPE_HEX: Record<MissionType, string> = {
  POSER:            '#3b82f6',
  RETIRER:          '#ef4444',
  ECHANGER:         '#f59e0b',
  VIDER:            '#8b5cf6',
  PAUSE:            '#6b7280',
  CHARGER_IMMEDIAT: '#eab308',
  DEPLACER:         '#06b6d4',
  TASSER:           '#f97316',
  EXPEDIER:         '#10b981',
  ALLER_RETOUR:     '#0d9488',
}

export type RecurrenceRule =
  | { kind: 'daily';   everyN: number }
  | { kind: 'weekly';  weekDays: number[] }
  | { kind: 'monthly'; dayOfMonth: number }

export interface MissionTemplate {
  id:                   string
  label:                string
  enabled:              boolean
  type:                 MissionType
  recurrence:           RecurrenceRule
  address:              string
  latitude:             number
  longitude:            number
  clientName?:          string
  outletName?:          string
  estimatedDurationMin: number
  maneuverTimeMin:      number
  wasteTypeLabel?:      string
  binSize?:             string
  binSizeM3?:           number
  accessNotes?:         string
  priority?:            1 | 2 | 3
  timeWindow?:          TimeWindow
  linkedExutoireId?:    string
  startDate:            string
  endDate?:             string
}

export interface OptimizationResult {
  assignments:        Record<string, PlannedMission[]>
  unassignedMissions: Mission[]
  stats: {
    assignedMissions: number
    totalMissions:    number
    score:            number
    globalScore?:     number
    timeTakenMs:      number

    cvarScore?:       number

    routingSource?:   string

    objectives?: {
      totalDistanceKm:  number
      totalLatenessMin: number
      workloadCV:       number
    }

    paretoFront?: Array<{
      label:            string
      totalDistanceKm:  number
      totalLatenessMin: number
      workloadCV:       number
    }>
  }
  warnings: Array<{
    driverId: string
    message:  string
    severity: 'warning' | 'error'
  }>
}

export interface TourStep {
  mission:          PlannedMission
  arrivalMin:       number
  departureMin:     number
  arrivalStr:       string
  departureStr:     string
  travelMin:        number
  roadDistKm:       number
  onSiteMin:        number
  hasMissingCoords?: boolean
  isSynthetic?:      boolean
}

export interface TourWarning {
  message:  string
  severity: 'warning' | 'error'
}

export interface TourResult {
  steps:            TourStep[]
  totalDurationMin: number
  totalRoadDistKm:  number
  totalDrivingMin:  number
  totalOnSiteMin:   number
  finishMin:        number
  finishStr:        string
  returnTravelMin:  number
  warnings:         TourWarning[]
  fuelCostEur?:     number
}
