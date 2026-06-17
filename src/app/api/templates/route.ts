import { NextRequest, NextResponse } from 'next/server'
import { z }                         from 'zod'
import { getTenantId }               from '@/lib/data/context'
import { createLogger }              from '@/lib/logger'
import prisma                        from '@/lib/db'
import { redisCache }                from '@/lib/redisCache'
import type { Prisma }               from '@/generated/prisma'

const log = createLogger('/api/templates')

const MISSION_TYPES = ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR'] as const

const TemplateSchema = z.object({
  label:                z.string().min(1).max(200),
  type:                 z.enum(MISSION_TYPES),
  recurrence:           z.record(z.string(), z.unknown()),
  address:              z.string().min(1),
  latitude:             z.number().min(-90).max(90),
  longitude:            z.number().min(-180).max(180),
  startDate:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis'),
  endDate:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  enabled:              z.boolean().optional().default(true),
  clientName:           z.string().optional().default(''),
  estimatedDurationMin: z.number().int().min(0).max(1440).optional().default(30),
  maneuverTimeMin:      z.number().int().min(0).max(480).optional().default(10),
  wasteTypeLabel:       z.string().optional().default(''),
  binSize:              z.string().optional().default(''),
  binSizeM3:            z.number().positive().optional().nullable(),
  accessNotes:          z.string().optional().default(''),
  priority:             z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().nullable(),
  timeWindow: z.object({
    openMin:  z.number().int().min(0).max(1439),
    closeMin: z.number().int().min(0).max(1439),
  }).refine(tw => tw.closeMin > tw.openMin, { message: 'closeMin doit être > openMin' })
    .optional().nullable(),
  linkedExutoireId: z.string().optional().nullable(),
})

export type TemplateInput = z.infer<typeof TemplateSchema>

const TEMPLATE_SELECT = {
  id: true, label: true, type: true, recurrence: true,
  address: true, latitude: true, longitude: true,
  startDate: true, endDate: true, enabled: true,
  clientName: true, estimatedDurationMin: true, maneuverTimeMin: true,
  wasteTypeLabel: true, binSize: true, binSizeM3: true,
  accessNotes: true, priority: true, timeWindow: true, linkedExutoireId: true,
  createdAt: true, updatedAt: true,
} as const

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  try {
    const templates = await redisCache.getOrSet(
      'templates',
      tenantId,
      () => prisma.missionTemplate.findMany({
        where:   { tenantId },
        select:  TEMPLATE_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
      60_000,
    )
    return NextResponse.json(templates, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = getTenantId(req)

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = TemplateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { timeWindow, ...rest } = parsed.data

  try {
    const template = await prisma.missionTemplate.create({
      data: {
        tenantId,
        ...rest,
        recurrence: rest.recurrence as Prisma.InputJsonValue,
        timeWindow: timeWindow ?? undefined,
      },
    })
    void redisCache.invalidateAll('templates', tenantId)
    return NextResponse.json(template, { status: 201 })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
