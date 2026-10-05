import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * Tenant-namespaced file storage for driver photos, signatures and delivery proofs.
 *
 * Files live OUTSIDE `public/` (default `<cwd>/data/uploads`, override with UPLOAD_DIR) and are
 * only ever served by the authenticated `GET /api/files/<tenantId>/<kind>/<name>` route — a
 * statically-served upload is readable by anyone who learns (or guesses) its URL, across tenants.
 *
 * Layout: `<root>/<tenantId>/<kind>/<name>`. Every path segment is validated against SAFE_SEGMENT
 * so no caller-controlled value can escape the tenant directory.
 */

export type UploadKind = 'photos' | 'proofs'

const SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,159}$/

export function uploadRoot(): string {
  return process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), 'data', 'uploads')
}

/** Files written before tenant-namespaced storage existed (served via /uploads/*). */
export function legacyUploadRoot(): string {
  return path.join(process.cwd(), 'public', 'uploads')
}

export function isSafeSegment(s: string): boolean {
  return SAFE_SEGMENT.test(s) && !s.includes('..')
}

/** Replaces every character outside [A-Za-z0-9_-] — for building names from ids. */
export function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
}

export function resolveUploadPath(tenantId: string, kind: UploadKind, name: string): string {
  if (!isSafeSegment(tenantId) || !isSafeSegment(name)) throw new Error('Unsafe upload path segment')
  return path.join(uploadRoot(), tenantId, kind, name)
}

export function uploadUrl(tenantId: string, kind: UploadKind, name: string): string {
  return `/api/files/${encodeURIComponent(tenantId)}/${kind}/${encodeURIComponent(name)}`
}

export async function writeUpload(tenantId: string, kind: UploadKind, name: string, data: Buffer): Promise<string> {
  const target = resolveUploadPath(tenantId, kind, name)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, data)
  return uploadUrl(tenantId, kind, name)
}

export async function deleteUpload(tenantId: string, kind: UploadKind, name: string): Promise<void> {
  await fs.unlink(resolveUploadPath(tenantId, kind, name)).catch(err => {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  })
}

export async function listUploads(tenantId: string, kind: UploadKind): Promise<string[]> {
  if (!isSafeSegment(tenantId)) return []
  try {
    return await fs.readdir(path.join(uploadRoot(), tenantId, kind))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
}

export function contentTypeFor(name: string): string | null {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? null
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const PNG_MAGIC  = [0x89, 0x50, 0x4e, 0x47]
const GIF_MAGIC  = [0x47, 0x49, 0x46, 0x38]

/**
 * Detects the real image format from the bytes — never trust a client-declared MIME type or
 * extension. Returns the extension to store the file under, or null if it isn't an accepted image.
 */
export function detectImageExt(buf: Uint8Array): 'jpg' | 'png' | 'gif' | 'webp' | null {
  if (buf.length >= 4 && PNG_MAGIC.every((b, i) => buf[i] === b))  return 'png'
  if (buf.length >= 3 && JPEG_MAGIC.every((b, i) => buf[i] === b)) return 'jpg'
  if (buf.length >= 4 && GIF_MAGIC.every((b, i) => buf[i] === b))  return 'gif'
  if (buf.length >= 12
    && Buffer.from(buf.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(buf.subarray(8, 12)).toString('ascii') === 'WEBP') return 'webp'
  return null
}
