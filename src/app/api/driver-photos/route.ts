import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { verifySession, SESSION_COOKIE, type SessionPayload } from '@/lib/session'
import { unscopedPrisma, getTenantDb } from '@/lib/tenantDb'
import { withIdempotency } from '@/lib/idempotency'
import { canActForDriver, planContainsMission } from '@/lib/driverAccess'
import { deleteUpload, detectImageExt, listUploads, safeId, uploadUrl, writeUpload } from '@/lib/uploadStorage'

const log = createLogger('/api/driver-photos')

const useMock = process.env.USE_MOCK_DATA !== 'false'

const _mockPhotos = new Map<string, string>()

const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Signatures share the photo pipeline under `<missionId>_sig`. */
const SIG_SUFFIX = '_sig'

const PhotoSchema = z.object({
  driverId:  z.string().regex(SAFE_ID),
  date:      z.string().regex(DATE_RE),
  missionId: z.string().regex(SAFE_ID),
  dataUrl:   z.string().regex(/^data:image\/(jpeg|png|webp|gif);base64,/).max(5_500_000, 'Image trop volumineuse (max 4 MB)'),
})

function photoPrefix(driverId: string, date: string): string {
  return `${safeId(driverId)}_${date}_`
}

type Access =
  | { ok: true; tenantId: string; session: SessionPayload }
  | { ok: false; response: NextResponse }

/**
 * Session + ownership: staff of the driver's tenant, or that driver itself — a driver can never
 * read, overwrite or delete a colleague's photos/signatures.
 */
async function checkAccess(req: NextRequest, driverId: string): Promise<Access> {
  const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null
  if (!session) return { ok: false, response: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }

  if (useMock) return { ok: true, tenantId: session.tenantId, session }

  // Tenant not yet known here — this lookup is what determines it, then compared to the session.
  const driver = await unscopedPrisma.driver.findUnique({ where: { id: driverId }, select: { tenantId: true } })
  if (!driver || !canActForDriver(session, driverId, driver.tenantId)) {
    return { ok: false, response: NextResponse.json({ error: 'Chauffeur introuvable ou accès refusé' }, { status: 403 }) }
  }
  return { ok: true, tenantId: driver.tenantId, session }
}

function baseMissionId(missionId: string): string {
  return missionId.endsWith(SIG_SUFFIX) ? missionId.slice(0, -SIG_SUFFIX.length) : missionId
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const driverId = req.nextUrl.searchParams.get('driverId') ?? ''
  const date     = req.nextUrl.searchParams.get('date') ?? ''
  if (!SAFE_ID.test(driverId) || !DATE_RE.test(date)) {
    return NextResponse.json({ error: 'driverId et date requis' }, { status: 400 })
  }

  const access = await checkAccess(req, driverId)
  if (!access.ok) return access.response

  if (useMock) {
    const result: Record<string, string> = {}
    for (const [key, url] of _mockPhotos.entries()) {
      const [d, dt, mid] = key.split('|')
      if (d === driverId && dt === date) result[mid] = url
    }
    return NextResponse.json(result)
  }

  try {
    const prefix = photoPrefix(driverId, date)
    const result: Record<string, string> = {}
    for (const name of await listUploads(access.tenantId, 'photos')) {
      if (!name.startsWith(prefix)) continue
      const missionId = name.slice(prefix.length).replace(/\.[a-z]+$/, '')
      result[missionId] = uploadUrl(access.tenantId, 'photos', name)
    }
    return NextResponse.json(result)
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 }) }

  const parsed = PhotoSchema.safeParse(body)
  if (!parsed.success) {
    const tooBig = parsed.error.issues.some(i => i.path[0] === 'dataUrl' && i.code === 'too_big')
    return NextResponse.json(
      { error: tooBig ? 'Image trop volumineuse (max 4 MB)' : 'driverId, date, missionId et dataUrl (image) requis' },
      { status: tooBig ? 413 : 400 },
    )
  }
  const { driverId, date, missionId, dataUrl } = parsed.data

  const access = await checkAccess(req, driverId)
  if (!access.ok) return access.response

  // The data URL's declared MIME type is client-controlled — the decoded bytes must actually be
  // one of the accepted image formats, and the stored extension comes from those bytes.
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64')
  const ext = detectImageExt(buffer)
  if (!ext) {
    return NextResponse.json(
      { error: 'Contenu du fichier invalide (ne correspond à aucun format image accepté)' },
      { status: 422 },
    )
  }

  return withIdempotency(req, access.tenantId, 'POST /api/driver-photos', parsed.data, async () => {
    if (useMock) {
      _mockPhotos.set(`${driverId}|${date}|${missionId}`, dataUrl)
      return NextResponse.json({ url: dataUrl })
    }

    try {
      if (access.session.role === 'driver'
        && !(await planContainsMission(getTenantDb(access.tenantId), driverId, date, baseMissionId(missionId)))) {
        return NextResponse.json({ error: 'Mission absente de votre tournée' }, { status: 404 })
      }

      const prefix = photoPrefix(driverId, date)
      const stem   = `${prefix}${safeId(missionId)}`
      // One file per mission: drop a previous capture stored under another format.
      for (const name of await listUploads(access.tenantId, 'photos')) {
        if (name.startsWith(`${stem}.`)) await deleteUpload(access.tenantId, 'photos', name)
      }
      const url = await writeUpload(access.tenantId, 'photos', `${stem}.${ext}`, buffer)
      return NextResponse.json({ url })
    } catch (err) {
      log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }
  })
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const driverId  = req.nextUrl.searchParams.get('driverId') ?? ''
  const date      = req.nextUrl.searchParams.get('date') ?? ''
  const missionId = req.nextUrl.searchParams.get('missionId') ?? ''
  if (!SAFE_ID.test(driverId) || !DATE_RE.test(date) || !SAFE_ID.test(missionId)) {
    return NextResponse.json({ error: 'driverId, date et missionId requis' }, { status: 400 })
  }

  const access = await checkAccess(req, driverId)
  if (!access.ok) return access.response

  if (useMock) {
    _mockPhotos.delete(`${driverId}|${date}|${missionId}`)
    return NextResponse.json({ ok: true })
  }

  try {
    const stem = `${photoPrefix(driverId, date)}${safeId(missionId)}.`
    for (const name of await listUploads(access.tenantId, 'photos')) {
      if (name.startsWith(stem)) await deleteUpload(access.tenantId, 'photos', name)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
