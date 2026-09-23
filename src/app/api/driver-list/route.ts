import { NextRequest, NextResponse } from 'next/server'
import type { Driver } from '@/lib/types'
import { getMockDrivers } from '@/lib/mockData'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { redisCache } from '@/lib/redisCache'
import { getTenantDb } from '@/lib/tenantDb'
import { createLogger } from '@/lib/logger'

const log = createLogger('/api/driver-list')
const useMock = process.env.USE_MOCK_DATA !== 'false'

export interface DriverListItem {
  id:        string
  firstName: string
  lastName:  string
  sector:    string
  depotName: string
}

export interface DriverListBySector {
  sector:  string
  drivers: DriverListItem[]
}

export async function GET(req: NextRequest): Promise<NextResponse> {

  const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null
  if (!session) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  const tenantId = session.tenantId

  try {
    const result = await redisCache.getOrSet<DriverListBySector[]>(
      'driver-list',
      tenantId,
      async () => {
        let drivers: Driver[]
        if (useMock) {
          drivers = getMockDrivers().filter(d => !d.archived)
        } else {
          drivers = (await getTenantDb(tenantId).driver.findMany({
            select:  { id: true, firstName: true, lastName: true, sector: true, depotName: true },
            orderBy: [{ sector: 'asc' }, { lastName: 'asc' }],
          })) as Driver[]
        }

        const bySector = new Map<string, DriverListItem[]>()
        for (const d of drivers) {
          const list = bySector.get(d.sector) ?? []
          list.push({ id: d.id, firstName: d.firstName, lastName: d.lastName, sector: d.sector, depotName: d.depotName })
          bySector.set(d.sector, list)
        }

        const grouped: DriverListBySector[] = []
        for (const [sector, driverItems] of bySector.entries()) {
          grouped.push({ sector, drivers: driverItems })
        }
        grouped.sort((a, b) => a.sector.localeCompare(b.sector, 'fr'))
        return grouped
      },
      60_000,
    )

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
