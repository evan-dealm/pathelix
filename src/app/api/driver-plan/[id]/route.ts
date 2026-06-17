import { NextRequest, NextResponse } from 'next/server'
import type { PlannedMission, Driver } from '@/lib/types'
import { getMockDrivers } from '@/lib/mockData'
import { prismaRowToDriver } from '@/lib/prismaMappers'
import { createLogger } from '@/lib/logger'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

import prisma from '@/lib/db'

const log = createLogger('/api/driver-plan/[id]')

const useMock = process.env.USE_MOCK_DATA !== 'false'

let _mockDrivers: Driver[] | null = null
function getDriverStore(): Driver[] {
  if (!_mockDrivers) _mockDrivers = getMockDrivers()
  return _mockDrivers
}

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id: driverId } = await params
  const date = req.nextUrl.searchParams.get('date')

  if (!date) {
    return NextResponse.json({ error: 'Paramètre date requis' }, { status: 400 })
  }

  try {

    const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
    const session = token ? await verifySession(token) : null
    if (!session) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    let driver: Driver | undefined | null
    let tenantId = ''

    if (useMock) {
      driver = getDriverStore().find(d => d.id === driverId)
      tenantId = session.tenantId
    } else {
      const raw = await prisma.driver.findUnique({ where: { id: driverId } })
      if (raw) {
        driver = prismaRowToDriver(raw as unknown as Record<string, unknown>)
        tenantId = raw.tenantId
      } else {
        return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
      }
    }

    if (!driver) {
      return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    }

    const isOwnDriver = session.driverRef === driverId || session.sub === driverId
    const isAdminOrDispatcher = (session.role === 'admin' || session.role === 'dispatcher') && session.tenantId === tenantId
    if (!isOwnDriver && !isAdminOrDispatcher) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    let plan: PlannedMission[] = []
    let startTime = '07:00'
    let speedKmh  = 50
    let trade: string | null = null

    if (useMock) {

    } else {

      const [record, tenantRow] = await Promise.all([
        prisma.plan.findFirst({ where: { tenantId, driverId, date } }),
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { trade: true } }),
      ])
      if (record) {
        if (Array.isArray(record.missions)) {
          plan = record.missions as unknown as PlannedMission[]
        } else if (typeof record.missions === 'string') {
          plan = JSON.parse(record.missions) as PlannedMission[]
        }
        startTime = record.startTime
        speedKmh  = record.speedKmh
      }
      trade = tenantRow?.trade ?? null
    }

    return NextResponse.json(
      { driver, plan, startTime, speedKmh, date, trade },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    )
  } catch (err) {
    log.error('GET failed', { driverId, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
