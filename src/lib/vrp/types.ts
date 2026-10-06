import type { Mission, Exutoire } from '@/lib/types'
import type { OsrmMatrix } from './osrmMatrix'
import type { RegulationRules, ClockState } from './driverClock'

/**
 * Where and in what state a driver resumes a day already started (live re-optimisation): the
 * position and time, plus — when known from the field statuses — the regulatory counters and the
 * load already on board. Missing counters are taken as zero (fresh start).
 */
export interface DriverStartOverride {
  lat:     number
  lng:     number
  timeMin: number
  clock?:  Partial<ClockState>
  lunchTaken?: boolean
  load?:   { kg: number; m3: number; bins: number }
}

export interface Route {
  driverId: string
  missions: Mission[]
}

export interface RouteCacheEntry {

  arrivalMin: number

  exitTimeMin: number

  exitLat: number
  exitLng: number

  continuousDriving: number

  cumTravelMin: number
  cumWaitMin: number
  cumBreakMin: number
  cumExutoireMin: number
  cumOnSiteMin: number
  cumDrivingMin: number
  cumWorkMin: number

  cumPenaltyMin: number

  breakBefore: boolean

  exutoireId?: string
  exutoireArrivalMin?: number
  exutoireDepartureMin?: number
}

export interface RouteCache {
  entries: RouteCacheEntry[]
  totalCost: number
}

export interface VRPSolution {
  routes: Route[]
  cost: number
}

export interface CostContext {
  depotLat: number
  depotLng: number
  startTimeMin: number
  speedKmh: number
  exutoires: Exutoire[]
  date: string

  weights?: ObjectiveWeights

  familiarity?: FamiliarityMap

  osrmMatrix?: OsrmMatrix

  driverStartOverrides?: Map<string, DriverStartOverride>

  /** Driving/working-time rules (defaults: CE 561/2006 + 2002/15). */
  regulation?: RegulationRules

  /** Maximum work per day (min, breaks excluded) — tenant setting, 600 by default. */
  maxWorkMin?: number

  congestionMap?: Map<string, number>

  valhallaFactor?: number

  costConfig?: {
    lunchBreakEnabled?: boolean
    lunchBreakStartMin?: number
    lunchBreakEndMin?: number
    lunchBreakDurationMin?: number
    lunchBreakPenalty?: number
    overtimePenalty?: number
    overtimePerMin?: number
    fixedRouteCost?: number
  }
}

export interface ALNSParams {
  timeBudgetMs: number
  seed: number
  iterations: number
  destroyRatio: number

  saT0Ratio: number

  saTMinRatio: number

  rhoForget: number
}

export interface ObjectiveWeights {

  distance: number

  punctuality: number

  balance: number

  stability?: number
}

export type FamiliarityMap = Map<string, number>

export interface OptimizeOptions {
  timeBudgetMs?:     number
  seed?:             number
  lnsIterations?:    number
  lnsDestroyRatio?:  number
  verboseLog?:       boolean
  existingSequence?: string[]
  existingPlans?:    Record<string, string[]>
  defaultSpeedKmh?:  number
  defaultStartTime?: string
  tenantId?:         string
  valhallaFactor?:   number
  usePareto?:        boolean
  weights?: {
    distance:     number
    punctuality:  number
    balance:      number
    stability?:   number
  }
}
