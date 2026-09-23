import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createLogger } from '@/lib/logger'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { unscopedPrisma } from '@/lib/tenantDb'
import { withIdempotency } from '@/lib/idempotency'

const log = createLogger('/api/driver-photos')

const useMock = process.env.USE_MOCK_DATA !== 'false'

const _mockPhotos = new Map<string, string>()

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'photos')

const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const PNG_MAGIC  = [0x89, 0x50, 0x4e, 0x47]
const GIF_MAGIC  = [0x47, 0x49, 0x46, 0x38]

function isValidImageBuffer(buf: Buffer): boolean {
  if (buf.length >= 4 && PNG_MAGIC.every((b, i) => buf[i] === b))  return true
  if (buf.length >= 3 && JPEG_MAGIC.every((b, i) => buf[i] === b)) return true
  if (buf.length >= 4 && GIF_MAGIC.every((b, i) => buf[i] === b))  return true
  // WEBP: "RIFF"....."WEBP" — the middle 4 bytes are a little-endian chunk size, not checked
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true
  return false
}

async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
}

function photoKey(driverId: string, date: string, missionId: string): string {
  return `${driverId}|${date}|${missionId}`
}

function photoFilename(driverId: string, date: string, missionId: string): string {

  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_\-]/g, '_')
  return `${safe(driverId)}_${safe(date)}_${safe(missionId)}.jpg`
}

async function verifyDriverTenant(req: NextRequest, driverId: string): Promise<{ ok: true; tenantId: string } | { ok: false; response: NextResponse }> {
  const token   = req.cookies.get(SESSION_COOKIE)?.value ?? null
  const session = token ? await verifySession(token) : null
  if (!session) return { ok: false, response: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }

  if (!useMock) {
    // Tenant not yet known here — verifying which tenant this driverId belongs to is the point
    // of this lookup, so it must run unscoped, then compared against the session's tenantId.
    const driver = await unscopedPrisma.driver.findUnique({ where: { id: driverId }, select: { tenantId: true } })
    if (!driver || driver.tenantId !== session.tenantId) {
      return { ok: false, response: NextResponse.json({ error: 'Chauffeur introuvable ou accès refusé' }, { status: 403 }) }
    }
  }
  return { ok: true, tenantId: session.tenantId }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl
  const driverId  = searchParams.get('driverId')
  const date      = searchParams.get('date')

  if (!driverId || !date) {
    return NextResponse.json({ error: 'driverId et date requis' }, { status: 400 })
  }

  const check = await verifyDriverTenant(req, driverId)
  if (!check.ok) return check.response

  if (useMock) {
    const result: Record<string, string> = {}
    for (const [key, url] of _mockPhotos.entries()) {
      if (key.startsWith(`${driverId}|${date}|`)) {
        const missionId = key.split('|')[2]
        result[missionId] = url
      }
    }
    return NextResponse.json(result)
  }

  try {
    await ensureUploadDir()
    const files  = await fs.readdir(UPLOAD_DIR)
    const prefix = photoFilename(driverId, date, '').replace('.jpg', '')
    const result: Record<string, string> = {}

    for (const f of files) {
      if (f.startsWith(prefix)) {

        const missionId = f.replace(prefix, '').replace('.jpg', '')
        result[missionId] = `/uploads/photos/${f}`
      }
    }
    return NextResponse.json(result)
  } catch (err) {
    log.error('GET failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const { driverId, date, missionId, dataUrl } = body as Record<string, unknown>

  const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-]{1,100}$/

  if (
    typeof driverId  !== 'string' || !driverId  ||
    typeof date      !== 'string' || !date      ||
    typeof missionId !== 'string' || !missionId ||
    typeof dataUrl   !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(dataUrl)
  ) {
    return NextResponse.json(
      { error: 'driverId, date, missionId et dataUrl (image) requis' },
      { status: 400 },
    )
  }

  if (!SAFE_ID_REGEX.test(missionId) || !SAFE_ID_REGEX.test(driverId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Format de paramètre invalide' },
      { status: 400 },
    )
  }

  const check = await verifyDriverTenant(req, driverId as string)
  if (!check.ok) return check.response

  if (dataUrl.length > 5_500_000) {
    return NextResponse.json(
      { error: 'Image trop volumineuse (max 4 MB)' },
      { status: 413 },
    )
  }

  // The data URL's declared MIME type (checked above) is client-controlled and not trustworthy
  // on its own — verify the decoded bytes are actually one of the accepted image formats before
  // ever writing them to a statically-served path.
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  const buffer      = Buffer.from(base64Data, 'base64')
  if (!isValidImageBuffer(buffer)) {
    return NextResponse.json(
      { error: 'Contenu du fichier invalide (ne correspond à aucun format image accepté)' },
      { status: 422 },
    )
  }

  return withIdempotency(req, check.tenantId, 'POST /api/driver-photos', async () => {
    if (useMock) {
      _mockPhotos.set(photoKey(driverId, date, missionId), dataUrl)
      return NextResponse.json({ url: dataUrl })
    }

    try {
      await ensureUploadDir()

      const filename = photoFilename(driverId, date, missionId)
      await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer)

      return NextResponse.json({ url: `/uploads/photos/${filename}` })
    } catch (err) {
      log.error('POST failed', { err: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }
  })
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl
  const driverId  = searchParams.get('driverId')
  const date      = searchParams.get('date')
  const missionId = searchParams.get('missionId')

  if (!driverId || !date || !missionId) {
    return NextResponse.json({ error: 'driverId, date et missionId requis' }, { status: 400 })
  }

  const check = await verifyDriverTenant(req, driverId)
  if (!check.ok) return check.response

  if (useMock) {
    _mockPhotos.delete(photoKey(driverId, date, missionId))
    return NextResponse.json({ ok: true })
  }

  try {
    const filename = photoFilename(driverId, date, missionId)
    await fs.unlink(path.join(UPLOAD_DIR, filename)).catch(err => {
      log.warn('Failed to delete photo file', { filename, err: err instanceof Error ? err.message : String(err) })
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('DELETE failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
