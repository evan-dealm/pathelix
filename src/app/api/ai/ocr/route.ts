import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { createTenantRateLimiter } from '@/lib/rateLimit'
import { getTenantDb } from '@/lib/tenantDb'
import { getRedisClient } from '@/lib/redisClient'

const log = createLogger('/api/ai/ocr')

// 10 OCR jobs per tenant per hour
const _ocrRl = createTenantRateLimiter(10, 3_600_000, 'ai-ocr')

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

const OCR_QUEUE = 'ai:ocr:queue'
// Each entry holds a base64 image (up to ~7 MB): cap the backlog when the AI engine is down.
const OCR_QUEUE_MAX = 200

// Magic bytes for JPEG, PNG, WebP
const ALLOWED_MAGIC: Array<{ bytes: number[]; mask?: number[] }> = [
  { bytes: [0xFF, 0xD8, 0xFF] },                         // JPEG
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }, // PNG
  { bytes: [0x52, 0x49, 0x46, 0x46] },                   // WebP (RIFF)
]

function checkMagicBytes(buf: Uint8Array): boolean {
  for (const sig of ALLOWED_MAGIC) {
    if (sig.bytes.every((b, i) => buf[i] === b)) return true
  }
  return false
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, userId } = getRequestContext(req)

  const allowed = await _ocrRl.check(tenantId)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Quota OCR dépassé (10 jobs/heure par tenant)' },
      { status: 429 },
    )
  }

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-data requis' }, { status: 400 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Formulaire invalide' }, { status: 400 })
  }

  const file = formData.get('file')
  const missionId = formData.get('missionId')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Fichier requis (champ "file")' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `Fichier trop volumineux (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` },
      { status: 413 },
    )
  }

  const buf = new Uint8Array(await file.arrayBuffer())
  if (!checkMagicBytes(buf)) {
    return NextResponse.json(
      { error: 'Type de fichier non autorisé (JPEG, PNG, WebP uniquement)' },
      { status: 415 },
    )
  }

  const db = getTenantDb(tenantId)

  // IDOR: missionId must belong to this tenant
  if (missionId && typeof missionId === 'string') {
    const mission = await db.mission.findFirst({
      where: { id: missionId },
      select: { id: true },
    })
    if (!mission) {
      return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
    }
  }

  // The job is only accepted once it is actually queued: without Redis (or with the queue full —
  // each entry carries the image) it used to be answered 202 and then stay "pending" forever.
  const redis = await getRedisClient()
  if (!redis) {
    return NextResponse.json({ error: 'Service OCR indisponible, réessayez plus tard' }, { status: 503 })
  }
  try {
    if (await redis.llen(OCR_QUEUE) >= OCR_QUEUE_MAX) {
      log.warn('OCR queue full', { tenantId })
      return NextResponse.json({ error: 'Service OCR saturé, réessayez dans quelques minutes' }, { status: 503 })
    }
  } catch (err) {
    log.warn('OCR queue unreachable', { err: String(err) })
    return NextResponse.json({ error: 'Service OCR indisponible, réessayez plus tard' }, { status: 503 })
  }

  try {
    const job = await db.aiJob.create({
      data: {
        type: 'ocr',
        status: 'pending',
        missionId: missionId && typeof missionId === 'string' ? missionId : undefined,
        inputData: {
          filename:    file.name,
          size:        file.size,
          contentType: file.type,
          submittedBy: userId,
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      } as Parameters<typeof db.aiJob.create>[0]['data'],
    })

    try {
      await redis.lpush(OCR_QUEUE, JSON.stringify({
        jobId:    job.id,
        tenantId,
        missionId: missionId ?? null,
        file:     Buffer.from(buf).toString('base64'),
        filename: file.name,
      }))
    } catch (err) {
      log.warn('Failed to push OCR job to Redis queue', { jobId: job.id, err: String(err) })
      await db.aiJob.update({ where: { id: job.id }, data: { status: 'failed', errorMsg: 'queue_unavailable' } }).catch(() => {})
      return NextResponse.json({ error: 'Service OCR indisponible, réessayez plus tard' }, { status: 503 })
    }

    log.info('OCR job created', { tenantId, jobId: job.id, missionId, size: file.size })

    return NextResponse.json({ jobId: job.id, status: 'pending' }, { status: 202 })
  } catch (err) {
    log.error('OCR job creation failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
