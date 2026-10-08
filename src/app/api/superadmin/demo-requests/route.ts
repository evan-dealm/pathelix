import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { getRequestContext } from '@/lib/data/context'
import { logSuperadminAction } from '@/lib/superadminAudit'

const HandleSchema = z.object({ id: z.string().min(1).max(64), handled: z.boolean() })

/** Demo requests left on the public website, newest first. Platform-level data: superadmin only. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin')
    {return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })}
  if (process.env.USE_MOCK_DATA !== 'false') return NextResponse.json({ requests: [] })
  const requests = await prisma.demoRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  return NextResponse.json({ requests })
}

/** Marks a request as answered (or not): nothing else about it can be changed. */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { userId: superadminId, role, tenantId: ownTenantId } = getRequestContext(req)
  if (role !== 'superadmin')
    {return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })}
  const parsed = HandleSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  if (process.env.USE_MOCK_DATA !== 'false')
    {return NextResponse.json({ error: 'Indisponible en mode démo' }, { status: 503 })}
  const updated = await prisma.demoRequest.updateMany({
    where: { id: parsed.data.id },
    data: { handledAt: parsed.data.handled ? new Date() : null },
  })
  if (updated.count === 0)
    {return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })}
  await logSuperadminAction({
    superadminId,
    targetTenantId: ownTenantId,
    isImpersonation: false,
    method: 'PATCH',
    path: '/api/superadmin/demo-requests',
    action: parsed.data.handled ? 'demo_request_handled' : 'demo_request_reopened',
    details: { demoRequestId: parsed.data.id },
  })
  return NextResponse.json({ ok: true })
}
