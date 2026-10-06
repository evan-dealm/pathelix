import path from 'node:path'
import { getStorage, localRoot } from '@/lib/storage'

/**
 * Tenant-namespaced file storage for driver photos, signatures and delivery proofs.
 *
 * Files go through the storage backend (src/lib/storage: local disk outside `public/`, or an
 * S3-compatible bucket) and are only ever served by the authenticated
 * `GET /api/files/<tenantId>/<kind>/<name>` route — a statically-served upload is readable by
 * anyone who learns (or guesses) its URL, across tenants.
 *
 * Key: `<tenantId>/<kind>/<name>`. Every segment is validated against SAFE_SEGMENT so no
 * caller-controlled value can escape the tenant prefix.
 */

export type UploadKind = 'photos' | 'proofs'

const SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,159}$/

export function uploadRoot(): string {
  return localRoot()
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

function uploadKey(tenantId: string, kind: UploadKind, name: string): string {
  if (!isSafeSegment(tenantId) || !isSafeSegment(name)) throw new Error('Unsafe upload path segment')
  return `${tenantId}/${kind}/${name}`
}

export function uploadUrl(tenantId: string, kind: UploadKind, name: string): string {
  return `/api/files/${encodeURIComponent(tenantId)}/${kind}/${encodeURIComponent(name)}`
}

export async function writeUpload(tenantId: string, kind: UploadKind, name: string, data: Buffer): Promise<string> {
  await getStorage().put(uploadKey(tenantId, kind, name), data, contentTypeFor(name) ?? 'application/octet-stream')
  return uploadUrl(tenantId, kind, name)
}

export async function readUpload(tenantId: string, kind: UploadKind, name: string): Promise<Buffer | null> {
  return getStorage().get(uploadKey(tenantId, kind, name))
}

export async function deleteUpload(tenantId: string, kind: UploadKind, name: string): Promise<void> {
  await getStorage().delete(uploadKey(tenantId, kind, name))
}

export async function listUploads(tenantId: string, kind: UploadKind): Promise<string[]> {
  if (!isSafeSegment(tenantId)) return []
  return getStorage().list(`${tenantId}/${kind}`)
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
