import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { getRequestContext } from '@/lib/data/context'
import { signSession, SESSION_COOKIE, COOKIE_OPTIONS } from '@/lib/session'
import { TRADE_IDS } from '@/lib/trades'
import { createLogger } from '@/lib/logger'

const log = createLogger('/api/onboarding')

const OnboardingSchema = z.object({
  trade:           z.enum(TRADE_IDS),
  companyName:     z.string().max(120).optional(),
  timezone:        z.string().max(60).optional(),
  defaultStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  seedData:        z.boolean().optional(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)

  if (role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'Admin requis' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = OnboardingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Métier invalide', details: parsed.error.flatten() }, { status: 422 })
  }

  try {
    const { trade, companyName, timezone, defaultStartTime, seedData } = parsed.data

    const [tenant] = await prisma.$transaction([
      prisma.tenant.update({
        where: { id: tenantId },
        data:  {
          trade,
          ...(companyName ? { name: companyName } : {}),
          ...(timezone    ? { timezone }           : {}),
        },
        select: { id: true, name: true, trade: true },
      }),
      prisma.tenantSettings.upsert({
        where:  { tenantId },
        create: { tenantId, defaultStartTime: defaultStartTime ?? '07:00' },
        update: {
          ...(defaultStartTime ? { defaultStartTime } : {}),
          ...(timezone         ? { timezone }          : {}),
        },
      }),
    ])

    if (seedData) {
      const missionCount = await prisma.mission.count({ where: { tenantId } })
      if (missionCount === 0) {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        const dateStr = tomorrow.toISOString().split('T')[0]

        await prisma.$transaction([
          prisma.driver.createMany({
            data: [
              { tenantId, firstName: 'Jean', lastName: 'Dupont',  sector: 'Nord', depotName: 'Dépôt Nord', depotLat: 45.75, depotLng: 4.85 },
              { tenantId, firstName: 'Marie', lastName: 'Martin', sector: 'Sud',  depotName: 'Dépôt Sud',  depotLat: 45.72, depotLng: 4.83 },
            ],
            skipDuplicates: true,
          }),
          prisma.mission.createMany({
            data: [
              { tenantId, type: 'POSER',   date: dateStr, address: '12 rue de la Paix, Lyon',    latitude: 45.767, longitude: 4.833, estimatedDurationMin: 30, maneuverTimeMin: 10, clientName: 'Client A', priority: 2 },
              { tenantId, type: 'RETIRER', date: dateStr, address: '45 av. Berthelot, Lyon',      latitude: 45.748, longitude: 4.848, estimatedDurationMin: 25, maneuverTimeMin: 10, clientName: 'Client B', priority: 1 },
              { tenantId, type: 'ECHANGER',date: dateStr, address: '8 pl. Bellecour, Lyon',       latitude: 45.757, longitude: 4.832, estimatedDurationMin: 40, maneuverTimeMin: 15, clientName: 'Client C', priority: 2 },
            ],
            skipDuplicates: true,
          }),
        ])
        log.info('Seed data created', { tenantId, dateStr })
      }
    }

    log.info('Trade selected', { tenantId, trade: parsed.data.trade, userId })

    const newToken = await signSession({
      sub: userId,
      role: role as 'admin' | 'superadmin' | 'dispatcher' | 'driver',
      tenantId,
      trade: parsed.data.trade,
    })
    const response = NextResponse.json(tenant)
    response.cookies.set(SESSION_COOKIE, newToken, { ...COOKIE_OPTIONS, maxAge: 86400, path: '/' })
    return response
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { trade: true },
    })

    return NextResponse.json({ trade: tenant?.trade ?? null })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
