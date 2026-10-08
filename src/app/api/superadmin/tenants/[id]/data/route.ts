import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { logSuperadminAction } from '@/lib/superadminAudit'

const log = createLogger('/api/superadmin/tenants/[id]/data')

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {

  const { userId: superadminId, role } = getRequestContext(req)
  if (role !== 'superadmin') {
    return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  }

  const { id: tenantId } = await params
  const section = req.nextUrl.searchParams.get('section') ?? 'all'

  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } })
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })

    const result: Record<string, unknown> = { tenantId, tenantName: tenant.name }

    if (section === 'all' || section === 'users') {
      result.users = await prisma.user.findMany({
        where: { tenantId },
        select: { id: true, email: true, role: true, firstName: true, lastName: true, driverRef: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    }

    if (section === 'all' || section === 'drivers') {
      result.drivers = await prisma.driver.findMany({
        where: { tenantId },
        select: { id: true, firstName: true, lastName: true, phone: true, sector: true, depotName: true, depotLat: true, depotLng: true, maxBinSizeM3: true, archived: true, createdAt: true },
        orderBy: { firstName: 'asc' },
      })
    }

    if (section === 'all' || section === 'vehicles') {
      result.vehicles = await prisma.vehicle.findMany({
        where: { tenantId },
        select: { id: true, licensePlate: true, type: true, brand: true, capacityM3: true, status: true, createdAt: true },
        orderBy: { licensePlate: 'asc' },
      })
    }

    if (section === 'all' || section === 'missions') {
      result.missions = await prisma.mission.findMany({
        where: { tenantId },
        select: { id: true, type: true, date: true, address: true, clientName: true, wasteTypeLabel: true, priority: true, archived: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      result.missionsTotal = await prisma.mission.count({ where: { tenantId } })
    }

    if (section === 'all' || section === 'exutoires') {
      result.exutoires = await prisma.exutoire.findMany({
        where: { tenantId },
        select: { id: true, name: true, address: true, lat: true, lng: true, acceptedWasteTypes: true },
        orderBy: { name: 'asc' },
      })
    }

    if (section === 'all' || section === 'clients') {
      result.clients = await prisma.client.findMany({
        where: { tenantId },
        select: { id: true, name: true, contact: true, phone: true, email: true, vip: true, createdAt: true },
        orderBy: { name: 'asc' },
      })
    }

    if (section === 'all' || section === 'sites') {
      result.sites = await prisma.site.findMany({
        where: { tenantId },
        select: { id: true, name: true, address: true, latitude: true, longitude: true, createdAt: true },
        orderBy: { name: 'asc' },
      })
    }

    if (section === 'all' || section === 'templates') {
      result.templates = await prisma.missionTemplate.findMany({
        where: { tenantId },
        select: { id: true, label: true, type: true, enabled: true, address: true, clientName: true, recurrence: true, startDate: true, endDate: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    }

    if (section === 'all' || section === 'settings') {
      result.settings = await prisma.tenantSettings.findUnique({ where: { tenantId } })
    }

    // Reading an organisation's data leaves a trace, like acting on it does.
    await logSuperadminAction({
      superadminId,
      targetTenantId: tenantId,
      isImpersonation: false,
      method: 'GET',
      path: `/api/superadmin/tenants/${tenantId}/data`,
      action: 'tenant_data_read',
      details: { section },
    })

    return NextResponse.json(result)
  } catch (err) {
    log.error('GET failed', { tenantId, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
