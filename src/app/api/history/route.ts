import { NextRequest, NextResponse } from 'next/server'
import { z }                         from 'zod'
import { createLogger }              from '@/lib/logger'
import { getTenantId }               from '@/lib/data/context'
import { getTenantDb }                from '@/lib/tenantDb'

const log = createLogger('/api/history')

const useMock = process.env.USE_MOCK_DATA !== 'false'

interface MockTourHistory {
  id:        string
  tenantId:  string
  date:      string
  label:     string
  snapshot:  string
  createdAt: string
}

// eslint-disable-next-line no-var
declare global { var __historyMock: MockTourHistory[] | undefined }

function getMockHistory(): MockTourHistory[] {
  if (!globalThis.__historyMock) globalThis.__historyMock = []
  return globalThis.__historyMock
}

function isValidDate(d: string): boolean {
  const [y, mo, day] = d.split('-').map(Number)
  const dt = new Date(y, mo - 1, day)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === day
}

function parseSnapshot(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  const idParam  = req.nextUrl.searchParams.get('id')
  const limitStr = req.nextUrl.searchParams.get('limit')
  const limitParsed = limitStr ? parseInt(limitStr, 10) : NaN
  const limit    = !isNaN(limitParsed) ? Math.min(100, Math.max(1, limitParsed)) : 30

  try {

    if (idParam) {
      if (useMock) {

        const entry = getMockHistory().find(h => h.id === idParam && h.tenantId === tenantId)
        if (!entry) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
        return NextResponse.json({ ...entry, snapshot: parseSnapshot(entry.snapshot) })
      }
      const entry = await getTenantDb(tenantId).tourHistory.findFirst({ where: { id: idParam } })
      if (!entry) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
      return NextResponse.json({ ...entry, snapshot: parseSnapshot(entry.snapshot) })
    }

    if (useMock) {
      const sorted = [...getMockHistory()]
        .filter(h => h.tenantId === tenantId)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .slice(0, limit)
        .map(({ snapshot: _s, ...rest }) => rest)
      return NextResponse.json(sorted)
    }

    const records = await getTenantDb(tenantId).tourHistory.findMany({
      orderBy: { date: 'desc' },
      take:    limit,
      select:  { id: true, date: true, label: true, createdAt: true },
    })
    return NextResponse.json(records)
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

const TourHistoryCreateSchema = z.object({
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD requis'),
  label:    z.string().max(200).optional(),
  snapshot: z.unknown(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = getTenantId(req)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const parsed = TourHistoryCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { date, label, snapshot } = parsed.data

  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'Date invalide (date calendaire valide requise)' }, { status: 400 })
  }

  if (snapshot === null || snapshot === undefined) {
    return NextResponse.json({ error: 'Champ requis : snapshot' }, { status: 400 })
  }

  const snapshotStr = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot)

  if (snapshotStr.length > 10_000_000) {
    return NextResponse.json(
      { error: 'Snapshot trop volumineux (max 10 MB)' },
      { status: 413 },
    )
  }

  try {
    if (useMock) {
      const entry: MockTourHistory = {
        id:        crypto.randomUUID(),
        tenantId,
        date,
        label:     label ?? '',
        snapshot:  snapshotStr,
        createdAt: new Date().toISOString(),
      }
      getMockHistory().push(entry)
      return NextResponse.json({ ...entry, snapshot: undefined }, { status: 201 })
    }

    const db = getTenantDb(tenantId)
    const entry = await db.tourHistory.create({
      data: { date, label: label ?? '', snapshot: snapshotStr } as Parameters<typeof db.tourHistory.create>[0]['data'],
    })
    const { snapshot: _s, ...rest } = entry
    return NextResponse.json(rest, { status: 201 })
  } catch (err) {
    log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
