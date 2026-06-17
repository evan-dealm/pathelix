import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createLogger } from '@/lib/logger'
import { getRequestContext } from '@/lib/data/context'
import { TRADES, TRADE_IDS } from '@/lib/trades'

const log = createLogger('/api/superadmin/trades')

const CreateTradeSchema = z.object({
  tradeKey:            z.string().min(2).max(50).regex(/^[a-z0-9_]+$/, 'Uniquement lettres minuscules, chiffres et underscores'),
  tradeName:           z.string().min(1).max(100),
  tradeDescription:    z.string().max(500).optional(),
  tradeIcon:           z.string().max(10).optional(),
  vocabulary:          z.record(z.string(), z.unknown()),
  enabledMissionTypes: z.array(z.string()).min(1),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  try {

    const builtIn = TRADE_IDS.map(id => ({
      id: `builtin:${id}`,
      tradeKey: id,
      tradeName: TRADES[id].vocabulary.tradeName,
      tradeDescription: TRADES[id].vocabulary.tradeDescription,
      tradeIcon: TRADES[id].vocabulary.tradeIcon,
      enabledMissionTypes: TRADES[id].enabledMissionTypes,
      vocabulary: TRADES[id].vocabulary,
      isBuiltIn: true,
      createdAt: null,
    }))

    const custom = await prisma.customTrade.findMany({ orderBy: { createdAt: 'asc' } })
    const customMapped = custom.map(t => ({
      id: t.id,
      tradeKey: t.tradeKey,
      tradeName: t.tradeName,
      tradeDescription: t.tradeDescription,
      tradeIcon: t.tradeIcon,
      enabledMissionTypes: t.enabledMissionTypes as string[],
      vocabulary: t.vocabulary as Record<string, unknown>,
      isBuiltIn: false,
      createdAt: t.createdAt.toISOString(),
    }))

    return NextResponse.json({ trades: [...builtIn, ...customMapped] })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { role } = getRequestContext(req)
  if (role !== 'superadmin') return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = CreateTradeSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { tradeKey, tradeName, tradeDescription, tradeIcon, vocabulary, enabledMissionTypes } = parsed.data

  if ((TRADE_IDS as readonly string[]).includes(tradeKey)) {
    return NextResponse.json({ error: 'Cette clé est réservée à un métier intégré' }, { status: 409 })
  }

  try {
    const trade = await prisma.customTrade.create({
      data: {
        tradeKey,
        tradeName,
        tradeDescription: tradeDescription ?? '',
        tradeIcon: tradeIcon ?? '📋',
        vocabulary: vocabulary as object,
        enabledMissionTypes: enabledMissionTypes as string[],
      },
    })

    log.info('Custom trade created', { tradeKey, tradeName })
    return NextResponse.json(trade, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique')) {
      return NextResponse.json({ error: 'Un métier avec cette clé existe déjà' }, { status: 409 })
    }
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
