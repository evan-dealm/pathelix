import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { getTenantDb } from '@/lib/tenantDb'

const log = createLogger('/api/planning-notes')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { tenantId } = getRequestContext(req)
  const date = req.nextUrl.searchParams.get('date')
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: 'Paramètre date requis (YYYY-MM-DD)' }, { status: 400 })
  }

  try {
    const note = await getTenantDb(tenantId).planningNote.findUnique({ where: { tenantId_date: { tenantId, date } } })
    return NextResponse.json({
      date,
      text: note?.text ?? '',
      updatedAt: note?.updatedAt.toISOString() ?? null,
    })
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

const PutSchema = z.object({
  date: z.string().regex(DATE_RE),
  text: z.string().max(2000),
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
})

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role } = getRequestContext(req)
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Admin ou dispatcher requis' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const parsed = PutSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { date, text, expectedUpdatedAt } = parsed.data

  try {
    const db = getTenantDb(tenantId)

    // Optimistic concurrency: if the client last read a note at time T and someone else has
    // written since, reject rather than silently overwrite their edit — planning notes are
    // shared across dispatchers, this is the whole reason a shared table replaces localStorage.
    if (expectedUpdatedAt !== undefined) {
      const existing = await db.planningNote.findUnique({ where: { tenantId_date: { tenantId, date } } })
      const existingIso = existing?.updatedAt.toISOString() ?? null
      if (existingIso !== expectedUpdatedAt) {
        return NextResponse.json({
          error: 'Cette note a été modifiée par quelqu\'un d\'autre entre-temps',
          current: { date, text: existing?.text ?? '', updatedAt: existingIso },
        }, { status: 409 })
      }
    }

    if (!text.trim()) {
      await db.planningNote.deleteMany({ where: { date } })
      return NextResponse.json({ date, text: '', updatedAt: null })
    }

    const note = await db.planningNote.upsert({
      where:  { tenantId_date: { tenantId, date } },
      create: { date, text } as Parameters<typeof db.planningNote.upsert>[0]['create'],
      update: { text },
    })

    return NextResponse.json({ date, text: note.text, updatedAt: note.updatedAt.toISOString() })
  } catch (err) {
    log.error('PUT failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
