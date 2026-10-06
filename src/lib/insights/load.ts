import type { TenantDb } from '@/lib/tenantDb'
import type { PlannedMission } from '@/lib/types'
import { calcTour } from '@/lib/algorithm'
import { getAllExutoires } from '@/lib/data/exutoires'
import { missionProfits, type CostRates, type MissionMeta, type MissionProfit, type TourInput, type TourStepInput } from './profitability'

/** Which mission a synthetic plan step belongs to (dump trips carry the mission they empty). */
export function stepOwner(id: string): { kind: TourStepInput['kind']; missionId: string | null } {
  if (id.startsWith('_pause_')) return { kind: 'BREAK', missionId: null }
  if (id.startsWith('_vider_')) {
    const parts = id.replace(/^_vider_(pre_|ar_)?/, '').split('_')
    return { kind: 'DUMP', missionId: parts.slice(1).join('_') || null }
  }
  if (id.startsWith('_pose_ar_')) return { kind: 'MISSION', missionId: id.slice('_pose_ar_'.length) || null }
  if (id.startsWith('_')) return { kind: 'BREAK', missionId: null }
  return { kind: 'MISSION', missionId: id }
}

export interface ProfitabilityData {
  rows: MissionProfit[]
  rates: CostRates
  /** Inputs missing from the computation — shown with the figures. */
  gaps: string[]
  names: { clients: Record<string, string>; drivers: Record<string, string>; vehicles: Record<string, string> }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Executed tours of [from, to] (never beyond today) priced mission by mission. */
export async function loadProfitability(db: TenantDb, tenantId: string, from: string, to: string): Promise<ProfitabilityData> {
  const last = to < iso(new Date()) ? to : iso(new Date())
  const [settings, plans, exutoires, exFees] = await Promise.all([
    db.tenantSettings.findUnique({ where: { tenantId }, select: { costPerKm: true, fuelCostPerLiter: true, consumptionLPer100: true, driverHourlyCostEur: true } }),
    db.plan.findMany({
      where: { date: { gte: from, lte: last } },
      select: { driverId: true, date: true, missions: true, startTime: true, speedKmh: true, actualDistanceKm: true, actualDurationMin: true },
    }),
    getAllExutoires(tenantId),
    db.exutoire.findMany({ select: { id: true, feePerTonneEur: true, name: true } }),
  ])
  const rates: CostRates = {
    driverHourlyCostEur: settings?.driverHourlyCostEur ?? null,
    wearPerKm: settings?.costPerKm ?? 0.35,
    fuelPerKm: (settings?.fuelCostPerLiter ?? 1.8) * (settings?.consumptionLPer100 ?? 30) / 100,
  }
  const driverIds = [...new Set(plans.map(p => p.driverId))]
  const drivers = await db.driver.findMany({
    where: { id: { in: driverIds } },
    select: { id: true, firstName: true, lastName: true, depotLat: true, depotLng: true, vehicles: { where: { archived: false }, select: { id: true, licensePlate: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
  })
  const driverById = new Map(drivers.map(d => [d.id, d]))

  const tours: TourInput[] = []
  const missionIds = new Set<string>()
  for (const p of plans) {
    const d = driverById.get(p.driverId)
    const steps = Array.isArray(p.missions) ? p.missions as unknown as PlannedMission[] : []
    if (!d || steps.length === 0) continue
    const t = calcTour(steps, d.depotLat, d.depotLng, p.startTime, p.speedKmh, exutoires)
    const tourSteps: TourStepInput[] = t.steps.map(s => {
      const o = stepOwner(s.mission.id)
      if (o.missionId) missionIds.add(o.missionId)
      return { ...o, travelMin: s.travelMin, onSiteMin: s.onSiteMin, km: s.roadDistKm }
    })
    // Shared time: the drive back plus any wait for a customer's opening (the driver is paid).
    const stepMin = t.steps.reduce((a, s) => a + s.travelMin + s.onSiteMin, 0)
    tours.push({
      date: p.date, driverId: p.driverId, vehicleId: d.vehicles[0]?.id ?? null, steps: tourSteps,
      returnMin: t.returnTravelMin + Math.max(0, t.totalDurationMin - stepMin - t.returnTravelMin),
      returnKm: Math.max(0, t.totalRoadDistKm - t.steps.reduce((a, s) => a + s.roadDistKm, 0)),
      actualKm: p.actualDistanceKm, actualMin: p.actualDurationMin,
    })
  }

  const ids = [...missionIds]
  const [missions, lines, weighings] = await Promise.all([
    db.mission.findMany({ where: { id: { in: ids } }, select: { id: true, date: true, type: true, clientId: true, clientName: true } }),
    // Every issued document counts (it has a number), cancelled ones included: a fully credited
    // invoice is marked CANCELLED and its credit note nets it out — excluding it would leave the
    // credit note alone, i.e. negative revenue.
    db.invoiceLine.findMany({ where: { missionId: { in: ids }, invoice: { number: { not: null } } }, select: { missionId: true, amountHT: true } }),
    db.weighing.findMany({ where: { missionId: { in: ids }, exutoireId: { not: null }, status: 'VALIDATED' }, select: { missionId: true, exutoireId: true, netKg: true } }),
  ])
  const meta = new Map<string, MissionMeta>(missions.map(m => [m.id, { id: m.id, date: m.date, type: m.type, clientId: m.clientId, clientName: m.clientName ?? '' }]))
  const revenue = new Map<string, number>()
  for (const l of lines) if (l.missionId) revenue.set(l.missionId, (revenue.get(l.missionId) ?? 0) + l.amountHT)
  const feeOf = new Map(exFees.map(e => [e.id, e.feePerTonneEur]))
  const dumpFees = new Map<string, number>()
  const unpricedOutlets = new Set<string>()
  for (const w of weighings) {
    if (!w.missionId || !w.exutoireId) continue
    const fee = feeOf.get(w.exutoireId)
    if (fee === null || fee === undefined) { unpricedOutlets.add(w.exutoireId); continue }
    dumpFees.set(w.missionId, (dumpFees.get(w.missionId) ?? 0) + w.netKg / 1000 * fee)
  }

  const rows = missionProfits(tours, rates, meta, revenue, dumpFees)
  const gaps: string[] = []
  if (rates.driverHourlyCostEur === null) gaps.push('Coût horaire chauffeur non renseigné (Paramètres) : la main-d\'œuvre n\'est pas comptée')
  if (unpricedOutlets.size > 0) gaps.push(`Prix de traitement absent pour ${[...unpricedOutlets].map(id => exFees.find(e => e.id === id)?.name ?? id).join(', ')} : ces vidages ne sont pas comptés`)
  const unbilled = rows.filter(r => !r.invoiced).length
  if (unbilled > 0) gaps.push(`${unbilled} intervention${unbilled > 1 ? 's' : ''} sans facture émise : leur chiffre d'affaires est à 0`)
  gaps.push('Péages non inclus ; distances estimées sauf tournées avec relevé GPS')

  const clientIds = [...new Set(rows.map(r => r.clientId).filter((x): x is string => !!x))]
  const clients = clientIds.length ? await db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : []
  return {
    rows, rates, gaps,
    names: {
      clients: Object.fromEntries(clients.map(c => [c.id, c.name])),
      drivers: Object.fromEntries(drivers.map(d => [d.id, `${d.firstName} ${d.lastName}`.trim()])),
      vehicles: Object.fromEntries(drivers.flatMap(d => d.vehicles.map(v => [v.id, v.licensePlate]))),
    },
  }
}
