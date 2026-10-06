import path from 'node:path'
import fs from 'node:fs/promises'
import { createLogger } from '@/lib/logger'

const log = createLogger('storage')

/**
 * File storage behind one interface, so business code never touches the disk directly.
 *
 * - `local` (default): files under UPLOAD_DIR (default `<cwd>/data/uploads`), outside `public/`.
 *   Fine for a single instance with a persistent volume.
 * - `s3`: any S3-compatible object store (AWS, Scaleway, OVH, MinIO…) — STORAGE_DRIVER=s3 with
 *   S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and optionally S3_ENDPOINT /
 *   S3_FORCE_PATH_STYLE. Needed as soon as several app instances run.
 *
 * Keys are `<tenantId>/<kind>/…`; every segment is validated so no caller value escapes its
 * tenant prefix. Files are only ever served through authenticated routes.
 */
export interface StorageBackend {
  readonly name: 'local' | 's3'
  put(_key: string, _data: Buffer, _contentType: string): Promise<void>
  get(_key: string): Promise<Buffer | null>
  delete(_key: string): Promise<void>
  /** Object names directly under a prefix (no recursion), without the prefix. */
  list(_prefix: string): Promise<string[]>
}

const SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,159}$/

export function isSafeKey(key: string): boolean {
  const parts = key.split('/')
  return parts.length >= 2 && parts.length <= 6 && parts.every(p => SAFE_SEGMENT.test(p) && !p.includes('..'))
}

function assertSafeKey(key: string): void {
  if (!isSafeKey(key)) throw new Error('Unsafe storage key')
}

export function localRoot(): string {
  return process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(process.cwd(), 'data', 'uploads')
}

class LocalStorage implements StorageBackend {
  readonly name = 'local' as const
  private file(key: string): string {
    assertSafeKey(key)
    return path.join(localRoot(), ...key.split('/'))
  }
  async put(key: string, data: Buffer): Promise<void> {
    const f = this.file(key)
    await fs.mkdir(path.dirname(f), { recursive: true })
    // Write then rename: a reader never sees half a file.
    const tmp = `${f}.${process.pid}.tmp`
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, f)
  }
  async get(key: string): Promise<Buffer | null> {
    try { return await fs.readFile(this.file(key)) } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }
  async delete(key: string): Promise<void> {
    await fs.unlink(this.file(key)).catch(err => { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err })
  }
  async list(prefix: string): Promise<string[]> {
    const p = prefix.replace(/\/+$/, '')
    if (!p.split('/').every(s => SAFE_SEGMENT.test(s))) return []
    try {
      const entries = await fs.readdir(path.join(localRoot(), ...p.split('/')), { withFileTypes: true })
      return entries.filter(e => e.isFile() && !e.name.endsWith('.tmp')).map(e => e.name)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }
}

class S3Storage implements StorageBackend {
  readonly name = 's3' as const
  private clientPromise: Promise<import('@aws-sdk/client-s3').S3Client> | null = null
  private bucket = process.env.S3_BUCKET ?? ''

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = import('@aws-sdk/client-s3').then(({ S3Client }) => new S3Client({
        region: process.env.S3_REGION ?? 'us-east-1',
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        credentials: process.env.S3_ACCESS_KEY_ID ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
        } : undefined,
        requestHandler: { requestTimeout: 15_000 } as never,
      }))
    }
    return this.clientPromise
  }
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key)
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    await (await this.client()).send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: process.env.S3_SSE === 'false' ? undefined : 'AES256' }))
  }
  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key)
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    try {
      const out = await (await this.client()).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      const bytes = await out.Body?.transformToByteArray()
      return bytes ? Buffer.from(bytes) : null
    } catch (err) {
      const name = (err as { name?: string }).name
      if (name === 'NoSuchKey' || name === 'NotFound') return null
      throw err
    }
  }
  async delete(key: string): Promise<void> {
    assertSafeKey(key)
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    await (await this.client()).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
  async list(prefix: string): Promise<string[]> {
    const p = `${prefix.replace(/\/+$/, '')}/`
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
    const names: string[] = []
    let token: string | undefined
    do {
      const out = await (await this.client()).send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: p, Delimiter: '/', ContinuationToken: token }))
      for (const o of out.Contents ?? []) if (o.Key) names.push(o.Key.slice(p.length))
      token = out.IsTruncated ? out.NextContinuationToken : undefined
    } while (token)
    return names
  }
}

const _g = globalThis as typeof globalThis & { __pathelixStorage?: StorageBackend }

/** The configured backend (one instance per process). */
export function getStorage(): StorageBackend {
  if (!_g.__pathelixStorage) {
    const wantS3 = process.env.STORAGE_DRIVER === 's3'
    if (wantS3 && !process.env.S3_BUCKET) log.error('STORAGE_DRIVER=s3 without S3_BUCKET — falling back to local storage')
    _g.__pathelixStorage = wantS3 && process.env.S3_BUCKET ? new S3Storage() : new LocalStorage()
    log.info('Storage backend', { driver: _g.__pathelixStorage.name })
  }
  return _g.__pathelixStorage
}

/** For tests: swap the backend. */
export function setStorageForTests(s: StorageBackend | undefined): void {
  _g.__pathelixStorage = s
}
