import { NextRequest, NextResponse } from 'next/server'
import type { PlannedMission, Driver, Exutoire } from '@/lib/types'
import { getMockDrivers } from '@/lib/mockData'
import { prismaRowToDriver } from '@/lib/prismaMappers'
import { createLogger } from '@/lib/logger'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getAllExutoires } from '@/lib/data/exutoires'
import { checkTenantSuspension } from '@/lib/data/context'
import { canActForDriver } from '@/lib/driverAccess'
import { isMissionStatus, type MissionStatus } from '@/lib/missionStatus'

import { unscopedPrisma, getTenantDb } from '@/lib/tenantDb'

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

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Paramètre date requis (AAAA-MM-JJ)' }, { status: 400 })
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
      // Tenant not yet known here — this lookup is what determines it.
      const raw = await unscopedPrisma.driver.findUnique({ where: { id: driverId } })
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

    if (!canActForDriver(session, driverId, tenantId)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    const suspended = await checkTenantSuspension(tenantId, session.role)
    if (suspended) return suspended

    let plan: PlannedMission[] = []
    let startTime = '07:00'
    let speedKmh  = 50
    let trade: string | null = null
    let exutoires: Exutoire[] = []
    // Server-side progression per mission (Plan.statuses) — the app merges it with its own
    // not-yet-synced local changes, so a status survives a device change or a cleared cache.
    const statuses: Record<string, MissionStatus> = {}

    if (useMock) {
      exutoires = await getAllExutoires(tenantId)
    } else {

      const [record, tenantRow, exutoireRows] = await Promise.all([
        getTenantDb(tenantId).plan.findFirst({ where: { driverId, date } }),
        unscopedPrisma.tenant.findUnique({ where: { id: tenantId }, select: { trade: true } }),
        getAllExutoires(tenantId),
      ])
      if (record) {
        if (Array.isArray(record.missions)) {
          plan = record.missions as unknown as PlannedMission[]
        } else if (typeof record.missions === 'string') {
          plan = JSON.parse(record.missions) as PlannedMission[]
        }
        startTime = record.startTime
        speedKmh  = record.speedKmh
        if (record.statuses && typeof record.statuses === 'object' && !Array.isArray(record.statuses)) {
          for (const [missionId, entry] of Object.entries(record.statuses as Record<string, unknown>)) {
            const st = entry && typeof entry === 'object' ? (entry as { status?: unknown }).status : entry
            if (isMissionStatus(st)) statuses[missionId] = st
          }
        }
      }
      trade = tenantRow?.trade ?? null
      exutoires = exutoireRows
    }

    return NextResponse.json(
      { driver, plan, statuses, startTime, speedKmh, date, trade, exutoires },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (err) {
    log.error('GET failed', { driverId, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
