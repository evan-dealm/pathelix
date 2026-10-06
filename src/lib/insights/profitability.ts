/**
 * Profitability: what each intervention brought in (invoiced, net of credit notes) against what it
 * cost (driver time, kilometres, outlet fees), then grouped by customer, driver, truck, mission
 * type or day.
 *
 * Costs come from the executed tours. A tour's time and kilometres are split between its missions
 * by what each one used: the drive to it and the time on site; a dump trip counts for the mission
 * whose bin it empties; breaks and the drive back to the depot are shared in proportion. When the
 * tour carries measured figures (GPS distance, real duration) the estimate is scaled to them.
 * Inputs that are not known are left out and reported (`gaps`) rather than guessed.
 */

export interface CostRates {
  /** Loaded driver cost per hour, € — null when not configured. */
  driverHourlyCostEur: number | null
  /** Wear and maintenance per km, €. */
  wearPerKm: number
  /** Fuel per km, € (price per litre × consumption). */
  fuelPerKm: number
}

export interface TourStepInput {
  /** Mission the step belongs to (a dump step: the mission it empties); null for breaks. */
  missionId: string | null
  kind: 'MISSION' | 'DUMP' | 'BREAK'
  travelMin: number
  onSiteMin: number
  km: number
}

export interface TourInput {
  date: string
  driverId: string
  vehicleId: string | null
  steps: TourStepInput[]
  returnMin: number
  returnKm: number
  actualKm?: number | null
  actualMin?: number | null
}

export interface MissionMeta { id: string; date: string; type: string; clientId: string | null; clientName: string }

export interface MissionProfit {
  missionId: string
  date: string
  type: string
  clientId: string | null
  clientName: string
  driverId: string
  vehicleId: string | null
  minutes: number
  km: number
  labourCost: number
  distanceCost: number
  dumpCost: number
  cost: number
  revenueHT: number
  margin: number
  invoiced: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Splits one tour between its missions (minutes and km), then prices them. */
export function allocateTour(tour: TourInput, rates: CostRates): Array<{ missionId: string; minutes: number; km: number; labourCost: number; distanceCost: number }> {
  const own = new Map<string, { minutes: number; km: number }>()
  let sharedMin = tour.returnMin
  let sharedKm = tour.returnKm
  for (const s of tour.steps) {
    if (s.kind === 'BREAK' || !s.missionId) { sharedMin += s.travelMin + s.onSiteMin; sharedKm += s.km; continue }
    const cur = own.get(s.missionId) ?? { minutes: 0, km: 0 }
    cur.minutes += s.travelMin + s.onSiteMin
    cur.km += s.km
    own.set(s.missionId, cur)
  }
  const ownMin = [...own.values()].reduce((a, v) => a + v.minutes, 0)
  const ownKm = [...own.values()].reduce((a, v) => a + v.km, 0)
  const estMin = ownMin + sharedMin
  const estKm = ownKm + sharedKm
  const minScale = tour.actualMin && estMin > 0 ? tour.actualMin / estMin : 1
  const kmScale = tour.actualKm && estKm > 0 ? tour.actualKm / estKm : 1
  return [...own.entries()].map(([missionId, v]) => {
    const minutes = (v.minutes + (ownMin > 0 ? sharedMin * v.minutes / ownMin : 0)) * minScale
    const km = (v.km + (ownKm > 0 ? sharedKm * v.km / ownKm : 0)) * kmScale
    return {
      missionId, minutes: Math.round(minutes), km: Math.round(km * 10) / 10,
      labourCost: rates.driverHourlyCostEur !== null ? r2(minutes / 60 * rates.driverHourlyCostEur) : 0,
      distanceCost: r2(km * (rates.wearPerKm + rates.fuelPerKm)),
    }
  })
}

/** Missions priced with their revenue and outlet fees. */
export function missionProfits(
  tours: TourInput[], rates: CostRates, missions: Map<string, MissionMeta>,
  revenue: Map<string, number>, dumpFees: Map<string, number>,
): MissionProfit[] {
  const out: MissionProfit[] = []
  for (const t of tours) {
    for (const a of allocateTour(t, rates)) {
      const m = missions.get(a.missionId)
      if (!m) continue
      const dumpCost = r2(dumpFees.get(a.missionId) ?? 0)
      const cost = r2(a.labourCost + a.distanceCost + dumpCost)
      const rev = r2(revenue.get(a.missionId) ?? 0)
      out.push({
        missionId: a.missionId, date: t.date, type: m.type, clientId: m.clientId, clientName: m.clientName,
        driverId: t.driverId, vehicleId: t.vehicleId, minutes: a.minutes, km: a.km,
        labourCost: a.labourCost, distanceCost: a.distanceCost, dumpCost, cost, revenueHT: rev,
        margin: r2(rev - cost), invoiced: revenue.has(a.missionId),
      })
    }
  }
  return out
}

export type GroupKey = 'client' | 'driver' | 'vehicle' | 'type' | 'day'

export interface ProfitGroup {
  key: string
  missions: number
  invoicedMissions: number
  minutes: number
  km: number
  revenueHT: number
  cost: number
  margin: number
  /** Margin over revenue, % — null without revenue. */
  marginPct: number | null
  /** Margin of the invoiced missions only (an unbilled mission is not a loss yet). */
  invoicedMargin: number
}

export function groupProfits(rows: MissionProfit[], by: GroupKey): ProfitGroup[] {
  const keyOf = (r: MissionProfit) => by === 'client' ? (r.clientId ?? `nom:${r.clientName || 'Sans client'}`)
    : by === 'driver' ? r.driverId : by === 'vehicle' ? (r.vehicleId ?? 'aucun') : by === 'type' ? r.type : r.date
  const groups = new Map<string, ProfitGroup>()
  for (const r of rows) {
    const k = keyOf(r)
    const g = groups.get(k) ?? { key: k, missions: 0, invoicedMissions: 0, minutes: 0, km: 0, revenueHT: 0, cost: 0, margin: 0, marginPct: null, invoicedMargin: 0 }
    g.missions++
    if (r.invoiced) { g.invoicedMissions++; g.invoicedMargin += r.margin }
    g.minutes += r.minutes; g.km += r.km; g.revenueHT += r.revenueHT; g.cost += r.cost; g.margin += r.margin
    groups.set(k, g)
  }
  return [...groups.values()].map(g => ({
    ...g, km: Math.round(g.km), revenueHT: r2(g.revenueHT), cost: r2(g.cost), margin: r2(g.margin), invoicedMargin: r2(g.invoicedMargin),
    marginPct: g.revenueHT > 0 ? Math.round(g.margin / g.revenueHT * 1000) / 10 : null,
  })).sort((a, b) => a.margin - b.margin)
}
