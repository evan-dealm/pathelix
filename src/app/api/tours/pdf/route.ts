import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'
import { getTenantDb } from '@/lib/tenantDb'
import { calcTour } from '@/lib/algorithm'
import type { TourPdfProps } from '@/lib/tourPdf'
import { generatePdfViaWorker } from '@/lib/queue/pdfQueue'
import type { PlannedMission, Driver } from '@/lib/types'
import { createLogger } from '@/lib/logger'

const log = createLogger('/api/tours/pdf')
const USE_MOCK = process.env.USE_MOCK_DATA !== 'false'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)
  const params    = req.nextUrl.searchParams
  const driverId  = params.get('driverId')
  const date      = params.get('date')

  if (!driverId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'driverId et date (YYYY-MM-DD) requis' }, { status: 400 })
  }

  if (USE_MOCK) {
    return NextResponse.json({ error: 'Non disponible en mode mock' }, { status: 503 })
  }

  try {
    const db = getTenantDb(tenantId)
    const [dbDriver, dbPlan] = await Promise.all([
      db.driver.findFirst({ where: { id: driverId, archived: false } }),
      db.plan.findFirst({
        where: { driverId, date },
        select: { missions: true, startTime: true, speedKmh: true },
      }),
    ])

    if (!dbDriver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })

    const missions = (dbPlan?.missions ?? []) as unknown as PlannedMission[]
    const startTime = dbPlan?.startTime ?? '07:00'
    const speedKmh  = dbPlan?.speedKmh  ?? 50

    const sorted = [...missions].sort((a, b) => a.sequenceOrder - b.sequenceOrder)

    const driver: Driver = {
      id:              dbDriver.id,
      firstName:       dbDriver.firstName,
      lastName:        dbDriver.lastName,
      sector:          dbDriver.sector,
      depotName:       dbDriver.depotName ?? '',
      depotLat:        dbDriver.depotLat,
      depotLng:        dbDriver.depotLng,
      vehicleCapacity: dbDriver.vehicleCapacity ?? 1,
      maxBinSizeM3:    dbDriver.maxBinSizeM3 ?? undefined,
      notes:           dbDriver.notes ?? undefined,
      startingExutoireId: dbDriver.startingExutoireId ?? null,
      weeklyHoursMax:  dbDriver.weeklyHoursMax,
      archived:        dbDriver.archived,
    }

    const tour = calcTour(sorted, driver.depotLat, driver.depotLng, startTime, speedKmh)

    const props: TourPdfProps = {
      driver,
      missions: sorted,
      date,
      startTime,
      steps:    tour.steps as unknown as TourPdfProps['steps'],
      totalKm:  tour.totalRoadDistKm,
      totalMin: tour.totalDurationMin,
    }

    // Rendered in a dedicated worker process (src/workers/pdfWorker.ts), not in this route
    // handler — @react-pdf/renderer loads its own React instance, which collides with the one
    // Next's webpack build bundles for this route (dual package hazard, see
    // docs/deploiement.md §4). No process has both problems at once.
    let pdf: Buffer
    try {
      pdf = await generatePdfViaWorker({ kind: 'tour', tenantId, props })
    } catch (err) {
      log.error('PDF worker unavailable or timed out', { driverId, err: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: 'Service de génération PDF indisponible, réessayez dans un instant' }, { status: 503 })
    }

    const filename = `tournee_${dbDriver.firstName}_${dbDriver.lastName}_${date}.pdf`
      .toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, '')

    return new NextResponse(pdf as unknown as BodyInit, {
      status:  200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(pdf.length),
        'Cache-Control':       'no-store',
      },
    })
  } catch (err) {
    log.error('PDF generation failed', { driverId, err: err instanceof Error ? err.stack ?? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur génération PDF' }, { status: 500 })
  }
}
