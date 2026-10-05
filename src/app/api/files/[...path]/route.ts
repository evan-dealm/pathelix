import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { isStaff } from '@/lib/driverAccess'
import {
  contentTypeFor, isSafeSegment, legacyUploadRoot, resolveUploadPath, safeId, type UploadKind,
} from '@/lib/uploadStorage'

const log = createLogger('/api/files')

type Params = { params: Promise<{ path: string[] }> }

const KINDS: readonly UploadKind[] = ['photos', 'proofs']

function notFound(): NextResponse {
  return NextResponse.json({ error: 'Fichier introuvable' }, { status: 404 })
}

async function serve(file: string, name: string): Promise<NextResponse> {
  const type = contentTypeFor(name)
  if (!type) return notFound()
  try {
    const data = await fs.readFile(file)
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type':           type,
        'Cache-Control':          'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition':    'inline',
      },
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('read failed', { err: err instanceof Error ? err.message : String(err) })
    }
    return notFound()
  }
}

/**
 * Authenticated access to uploaded files.
 *
 *   /api/files/<tenantId>/<photos|proofs>/<name>   tenant-namespaced storage (src/lib/uploadStorage.ts)
 *   /api/files/legacy/<…>                          files written to public/uploads before that existed,
 *                                                  reached through the `/uploads/*` rewrite in next.config.mjs
 *
 * Staff can read any file of their own tenant. A driver can only read its own photos/signatures
 * (photo names start with `<driverId>_`) — never another tenant's, never delivery proofs of others.
 */
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { tenantId, role, userId, driverRef: ref } = getRequestContext(req)
  const segments = (await params).path ?? []
  if (segments.length === 0 || !segments.every(isSafeSegment)) return notFound()

  const driverRef = ref ?? userId

  if (segments[0] === 'legacy') return serveLegacy(segments.slice(1), tenantId, role, driverRef)

  const [fileTenant, kind, name] = segments
  if (segments.length !== 3 || fileTenant !== tenantId || !KINDS.includes(kind as UploadKind)) return notFound()
  if (!isStaff(role) && !(kind === 'photos' && name.startsWith(`${safeId(driverRef)}_`))) return notFound()

  return serve(resolveUploadPath(fileTenant, kind as UploadKind, name), name)
}

async function serveLegacy(rest: string[], tenantId: string, role: string, driverRef: string): Promise<NextResponse> {
  const root = legacyUploadRoot()
  // Legacy delivery proofs: public/uploads/<safeTenantId>/proof-<uuid>.<ext>
  if (rest.length === 2 && rest[0] === safeId(tenantId) && rest[1].startsWith('proof-')) {
    if (!isStaff(role)) return notFound()
    return serve(path.join(root, rest[0], rest[1]), rest[1])
  }
  // Legacy driver photos: public/uploads/photos/<driverId>_<date>_<missionId>.jpg — not tenant
  // namespaced, so the owning driver's tenant must be checked in the database.
  if (rest.length === 2 && rest[0] === 'photos') {
    const name = rest[1]
    const driverId = name.split('_')[0]
    if (!driverId) return notFound()
    const { getTenantDb } = await import('@/lib/tenantDb')
    const driver = await getTenantDb(tenantId).driver.findFirst({ where: { id: driverId }, select: { id: true } })
    if (!driver) return notFound()
    if (!isStaff(role) && driverId !== safeId(driverRef)) return notFound()
    return serve(path.join(root, 'photos', name), name)
  }
  return notFound()
}
