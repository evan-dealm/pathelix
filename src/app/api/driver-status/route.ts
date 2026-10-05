import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { isStaff } from '@/lib/driverAccess'
import { loadStatusSnapshot } from '@/lib/driverStatusSnapshot'

const log = createLogger('/api/driver-status')

/**
 * Field progress for a day: `{ driverId: { missionId: status } }`, from Plan.statuses.
 * Staff get every driver of their tenant; a driver only ever gets its own entry.
 * Statuses are written by POST /api/driver-status/update (idempotent, offline queue).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId, driverRef } = getRequestContext(req)
  const date = req.nextUrl.searchParams.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Paramètre date requis (AAAA-MM-JJ)' }, { status: 400 })
  }

  const requested = req.nextUrl.searchParams.get('driverId') ?? undefined
  const driverId = isStaff(role) ? requested : (driverRef ?? userId)

  try {
    const snapshot = await loadStatusSnapshot(tenantId, date, driverId)
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
