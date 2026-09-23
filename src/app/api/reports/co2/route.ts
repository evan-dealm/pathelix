import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'
import { getTenantDb } from '@/lib/tenantDb'

const USE_MOCK = process.env.USE_MOCK_DATA !== 'false'

const CO2_G_PER_KM: Record<string, number> = {
  diesel:     270,
  essence:    185,
  gnv:         90,
  gnc:         90,
  gpl:        140,
  hybride:    120,
  electrique:  12,
  électrique:  12,
}
const CO2_DEFAULT = 270

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)

  if (USE_MOCK) {
    return NextResponse.json({
      period: { from: '', to: '' },
      totalKm: 0,
      totalCO2Kg: 0,
      byDriver: [],
      byFuelType: {},
    })
  }

  const params = req.nextUrl.searchParams
  const from   = params.get('from') ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const to     = params.get('to')   ?? new Date().toISOString().slice(0, 10)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Dates invalides (YYYY-MM-DD)' }, { status: 400 })
  }

  try {

    const plans = await getTenantDb(tenantId).plan.findMany({
      where: { date: { gte: from, lte: to } },
      select: {
        driverId: true,
        missions: true,
        driver: {
          select: {
            id:        true,
            firstName: true,
            lastName:  true,
            sector:    true,
            vehicles: {
              where:  { archived: false },
              take:   1,
              select: { fuelType: true, weightTon: true },
            },
          },
        },
      },
    })

    type DriverRow = {
      driverId:   string
      name:       string
      sector:     string
      fuelType:   string
      totalKm:    number
      totalCO2Kg: number
      missionCount: number
    }

    const driverMap = new Map<string, DriverRow>()
    const fuelBreakdown: Record<string, { km: number; co2Kg: number }> = {}

    for (const plan of plans) {
      const missions = plan.missions as Array<{ isSynthetic?: boolean; travelTimeMin?: number; roadDistKm?: number }>
      if (!Array.isArray(missions)) continue

      const fuelType = (plan.driver.vehicles[0]?.fuelType ?? 'diesel').toLowerCase()
      const gPerKm   = CO2_G_PER_KM[fuelType] ?? CO2_DEFAULT

      let kmThisPlan = 0
      let count       = 0
      for (const m of missions) {
        if (m.isSynthetic) continue
        kmThisPlan += m.roadDistKm ?? 0
        count++
      }

      const co2Kg = (kmThisPlan * gPerKm) / 1000

      const existing = driverMap.get(plan.driverId)
      if (existing) {
        existing.totalKm     += kmThisPlan
        existing.totalCO2Kg  += co2Kg
        existing.missionCount += count
      } else {
        driverMap.set(plan.driverId, {
          driverId:     plan.driver.id,
          name:         `${plan.driver.firstName} ${plan.driver.lastName}`,
          sector:       plan.driver.sector,
          fuelType,
          totalKm:      kmThisPlan,
          totalCO2Kg:   co2Kg,
          missionCount: count,
        })
      }

      if (!fuelBreakdown[fuelType]) fuelBreakdown[fuelType] = { km: 0, co2Kg: 0 }
      fuelBreakdown[fuelType].km    += kmThisPlan
      fuelBreakdown[fuelType].co2Kg += co2Kg
    }

    const byDriver = Array.from(driverMap.values())
      .map(d => ({ ...d, totalKm: Math.round(d.totalKm), totalCO2Kg: Math.round(d.totalCO2Kg * 10) / 10 }))
      .sort((a, b) => b.totalCO2Kg - a.totalCO2Kg)

    const totalKm    = byDriver.reduce((s, d) => s + d.totalKm, 0)
    const totalCO2Kg = Math.round(byDriver.reduce((s, d) => s + d.totalCO2Kg, 0) * 10) / 10

    return NextResponse.json({
      period:       { from, to },
      totalKm:      Math.round(totalKm),
      totalCO2Kg,
      totalCO2T:    Math.round(totalCO2Kg / 100) / 10,
      byDriver,
      byFuelType:   Object.fromEntries(
        Object.entries(fuelBreakdown).map(([k, v]) => [k, {
          km:    Math.round(v.km),
          co2Kg: Math.round(v.co2Kg * 10) / 10,
        }])
      ),
    })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
