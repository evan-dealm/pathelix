import { NextRequest, NextResponse }    from 'next/server'
import { z }                            from 'zod'
import { getRequestContext }            from '@/lib/data/context'
import { getFeatureFlags, invalidateFlagsCache } from '@/lib/featureFlags'
import { getTenantDb }                  from '@/lib/tenantDb'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)
  const flags = await getFeatureFlags(tenantId)
  return NextResponse.json({ flags })
}

const UpdateSchema = z.record(z.string(), z.boolean())

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Payload invalide' }, { status: 422 })

  await getTenantDb(tenantId).tenantSettings.upsert({
    where:  { tenantId },
    create: { features: parsed.data } as Parameters<ReturnType<typeof getTenantDb>['tenantSettings']['upsert']>[0]['create'],
    update: { features: parsed.data },
  })

  invalidateFlagsCache(tenantId)
  const flags = await getFeatureFlags(tenantId)
  return NextResponse.json({ flags })
}
