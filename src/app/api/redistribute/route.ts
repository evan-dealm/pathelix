import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import prisma from '@/lib/db'
import { computeRouteCost, computePrefixStates, computeInsertionDelta } from '@/lib/vrp/routeCost'

const log = createLogger('/api/redistribute')

const RedistributeSchema = z.object({
  driverId:  z.string().min(1),
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  apply:     z.boolean().optional(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = RedistributeSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { driverId, date, apply } = parsed.data

  try {

    const allPlans = await prisma.plan.findMany({
      where: { tenantId, date },
      select: { driverId: true, missions: true, startTime: true, speedKmh: true, locked: true },
    })

    const brokenPlan = allPlans.find(p => p.driverId === driverId)
    if (!brokenPlan) {
      return NextResponse.json({ error: 'Aucun plan trouvé pour ce chauffeur' }, { status: 404 })
    }

    const brokenMissions = (brokenPlan.missions as unknown as Array<{
      id: string; type: string; latitude: number; longitude: number;
      estimatedDurationMin: number; maneuverTimeMin: number; priority?: number;
      status?: string; [key: string]: unknown
    }>).filter(m => {

      const status = (m.status as string | undefined)?.toLowerCase()
      return !status || status === 'todo' || status === 'pending'
    })

    if (brokenMissions.length === 0) {
      return NextResponse.json({ error: 'Aucune mission à redistribuer', assignments: [] })
    }

    const availablePlans = allPlans.filter(p => p.driverId !== driverId && !p.locked)

    if (availablePlans.length === 0) {
      return NextResponse.json({ error: 'Aucun chauffeur disponible pour la redistribution' }, { status: 422 })
    }

    const drivers = await prisma.driver.findMany({
      where: { tenantId, archived: false },
      select: {
        id: true, firstName: true, lastName: true, sector: true,
        depotName: true, depotLat: true, depotLng: true,
        maxBinSizeM3: true, vehicleCapacity: true,
      },
    })

    const driverMap = new Map(drivers.map(d => [d.id, d]))

    const exutoires = await prisma.exutoire.findMany({
      where: { tenantId },
    })

    const ctx = {
      depotLat: 0, depotLng: 0,
      startTimeMin: 420, speedKmh: 50,
      exutoires: exutoires.map(e => ({
        id: e.id, name: e.name, address: e.address,
        lat: e.lat, lng: e.lng,
        openingHoursOpen: e.openingHoursOpen, openingHoursClose: e.openingHoursClose,
        closedDays: (e.closedDays as number[]) ?? [],
        acceptedWasteTypes: (e.acceptedWasteTypes as string[]) ?? [],
        serviceTimeMin: e.serviceTimeMin,
      })),
      date,
    }

    const assignments: Array<{
      missionId:    string
      fromDriverId: string
      toDriverId:   string
      toDriverName: string
      position:     number
      costDelta:    number
    }> = []

    const planCopies = new Map(
      availablePlans.map(p => [p.driverId, {
        driverId: p.driverId,
        missions: [...(p.missions as unknown as Array<Record<string, unknown>>)],
      }]),
    )

    const sorted = [...brokenMissions].sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3))

    for (const mission of sorted) {
      let bestDelta = Infinity
      let bestDriverId = ''
      let bestPos = 0

      for (const [availDriverId, plan] of planCopies) {
        const driver = driverMap.get(availDriverId)
        if (!driver) continue

        const route = { driverId: availDriverId, missions: plan.missions as Array<Record<string, unknown>> }
        const driverArr = [driver as unknown as import('@/lib/types').Driver]
        const baseCost = computeRouteCost(route as never, ctx as never, driverArr)
        const prefixStates = computePrefixStates(route as never, ctx as never, driverArr)

        for (let pos = 0; pos <= plan.missions.length; pos++) {
          const delta = computeInsertionDelta(
            route as never, mission as never, pos, prefixStates, baseCost, ctx as never, driverArr,
          )
          if (delta < bestDelta) {
            bestDelta = delta
            bestDriverId = availDriverId
            bestPos = pos
          }
        }
      }

      if (bestDriverId) {
        const driver = driverMap.get(bestDriverId)
        assignments.push({
          missionId: mission.id,
          fromDriverId: driverId,
          toDriverId: bestDriverId,
          toDriverName: driver ? `${driver.firstName} ${driver.lastName}` : bestDriverId,
          position: bestPos,
          costDelta: Math.round(bestDelta),
        })

        const plan = planCopies.get(bestDriverId)!
        plan.missions.splice(bestPos, 0, mission as unknown as Record<string, unknown>)
      }
    }

    if (apply && assignments.length > 0) {
      await prisma.$transaction(async (tx) => {

        await tx.plan.updateMany({
          where: { tenantId, driverId, date },
          data: { missions: [] },
        })

        await Promise.all(
          [...planCopies.entries()]
            .filter(([targetDriverId]) => assignments.some(a => a.toDriverId === targetDriverId))
            .map(([targetDriverId, plan]) =>
              tx.plan.updateMany({
                where: { tenantId, driverId: targetDriverId, date },
                data: { missions: plan.missions as object[] },
              }),
            ),
        )
      })

      log.info('Redistribution applied', { driverId, date, assignments: assignments.length })
    }

    return NextResponse.json({
      assignments,
      totalMissions: brokenMissions.length,
      assignedCount: assignments.length,
      unassignedCount: brokenMissions.length - assignments.length,
      applied: apply ?? false,
    })
  } catch (err) {
    log.error('Redistribute failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
