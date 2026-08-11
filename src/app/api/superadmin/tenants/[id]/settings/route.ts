import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { logSuperadminAction } from '@/lib/superadminAudit'

const log = createLogger('/api/superadmin/tenants/[id]/settings')

type Params = { params: Promise<{ id: string }> }

const SettingsSchema = z.object({
  defaultSpeedKmh: z.number().min(10).max(130).optional(),
  defaultStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  maxWorkDayMin: z.number().int().min(60).max(1440).optional(),
  pauseAfterMin: z.number().int().min(60).max(600).optional(),
  pauseDurationMin: z.number().int().min(5).max(120).optional(),
  costPerKm: z.number().min(0).max(10).optional(),
  fuelCostPerLiter: z.number().min(0).max(10).optional(),
  consumptionLPer100: z.number().min(1).max(100).optional(),
  primaryColor: z.string().max(20).optional(),
  companyDisplayName: z.string().max(200).optional(),
  maxOptimizationsPerDay: z.number().int().min(1).max(1000).optional(),
}).partial()

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {

  const { userId: superadminId, role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  const { id: tenantId } = await params

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = SettingsSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  try {

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })

    const settings = await prisma.tenantSettings.upsert({
      where: { tenantId },
      update: parsed.data,
      create: { tenantId, ...parsed.data },
    })

    logSuperadminAction({
      superadminId,
      targetTenantId: tenantId,
      isImpersonation: false,
      method: 'PUT',
      path: `/api/superadmin/tenants/${tenantId}/settings`,
      action: 'settings_updated',
      details: { changedKeys: Object.keys(parsed.data) },
    })

    log.info('Settings updated by superadmin', { tenantId, keys: Object.keys(parsed.data) })
    return NextResponse.json(settings)
  } catch (err) {
    log.error('PUT settings failed', { tenantId, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
