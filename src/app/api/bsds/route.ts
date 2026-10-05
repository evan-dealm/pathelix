import { NextRequest, NextResponse } from 'next/server'
import { tenantRefsError } from '@/lib/tenantRefs'
import { getTenantDb } from '@/lib/tenantDb'
import { getRequestContext }         from '@/lib/data/context'
import { handleApiError }            from '@/lib/apiError'
import { createLogger }              from '@/lib/logger'
import { BsddCreateSchema }          from '@/lib/trackdechets/validators'
import { createBsddInTd, getTokenFromAccount, mapTdStatus } from '@/lib/trackdechets/bsdService'
import { TdApiError }                from '@/lib/trackdechets/client'
import type { BsdStatus }            from '@/generated/prisma'

const log     = createLogger('/api/bsds')
const USE_MOCK = process.env.USE_MOCK_DATA !== 'false'

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_BSDS = [
  {
    id: 'bsd-mock-1', tdId: 'TD-26-AAA-00001', type: 'BSDD',
    status: 'DRAFT', missionId: null, readableId: 'TD-26-AAA-00001',
    payload: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
]

// ─── GET /api/bsds ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role === 'driver') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (USE_MOCK) {
    return NextResponse.json({ bsds: MOCK_BSDS, total: MOCK_BSDS.length })
  }

  const url       = new URL(req.url)
  const status    = url.searchParams.get('status') as BsdStatus | null
  const missionId = url.searchParams.get('missionId')
  const skip      = Math.max(0, parseInt(url.searchParams.get('skip') ?? '0', 10))
  const take      = Math.min(100, parseInt(url.searchParams.get('take') ?? '50', 10))

  try {
    const { default: prisma } = await import('@/lib/db')
    const where = {
      tenantId,
      ...(status    ? { status }    : {}),
      ...(missionId ? { missionId } : {}),
    }
    const [bsds, total] = await Promise.all([
      prisma.bsd.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true, tdId: true, type: true, status: true,
          missionId: true, readableId: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.bsd.count({ where }),
    ])
    return NextResponse.json({ bsds, total })
  } catch (err) {
    return handleApiError(err, log, { tenantId })
  }
}

// ─── POST /api/bsds ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role === 'driver') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const parsed = BsddCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 422 })
  }

  if (USE_MOCK) {
    const mockBsd = {
      bsdId: 'bsd-mock-new', tdId: `TD-26-MOCK-${Date.now()}`,
      status: 'DRAFT', readableId: `TD-26-MOCK-${Date.now()}`,
    }
    return NextResponse.json(mockBsd, { status: 201 })
  }

  try {
    const { default: prisma } = await import('@/lib/db')

    const account = await prisma.trackdechetsAccount.findUnique({ where: { tenantId } })
    if (!account) {
      return NextResponse.json(
        { error: 'Compte Trackdéchets non configuré pour ce tenant' },
        { status: 409 },
      )
    }

    // Checked BEFORE the Trackdéchets call: a BSD must never be filed for another tenant's mission.
    const refErr = await tenantRefsError(getTenantDb(tenantId), { missionId: parsed.data.missionId })
    if (refErr) return refErr

    const token   = getTokenFromAccount(account)
    const tdForm  = await createBsddInTd(token, parsed.data)
    const status  = mapTdStatus(tdForm.status)

    const bsd = await prisma.bsd.create({
      data: {
        tenantId,
        tdId:      tdForm.id,
        type:      'BSDD',
        status,
        missionId: parsed.data.missionId ?? null,
        readableId: tdForm.readableId ?? '',
        payload:   parsed.data as object,
      },
      select: { id: true, tdId: true, status: true, readableId: true },
    })

    log.info('BSD created', { tenantId, bsdId: bsd.id, tdId: bsd.tdId })
    return NextResponse.json({ bsdId: bsd.id, tdId: bsd.tdId, status: bsd.status, readableId: bsd.readableId }, { status: 201 })
  } catch (err) {
    if (err instanceof TdApiError) {
      log.error('TD API error creating BSD', { tenantId, errors: err.errors, status: err.statusCode })
      return NextResponse.json(
        { error: `Erreur Trackdéchets: ${err.message}` },
        { status: err.statusCode === 401 ? 502 : 502 },
      )
    }
    return handleApiError(err, log, { tenantId })
  }
}
