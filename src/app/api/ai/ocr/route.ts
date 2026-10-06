import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/data/context'
import { createLogger } from '@/lib/logger'
import { createTenantRateLimiter } from '@/lib/rateLimit'
import { getTenantDb } from '@/lib/tenantDb'
import { getRedisClient } from '@/lib/redisClient'
import { AI_JOB_QUEUE, AI_JOB_QUEUE_MAX, ocrEngineState, type OcrQueueItem } from '@/lib/ocr/engine'
import { detectDocumentType, storeDocument } from '@/lib/documents/archive'

const log = createLogger('/api/ai/ocr')

// 10 OCR jobs per tenant per hour
const _ocrRl = createTenantRateLimiter(10, 3_600_000, 'ai-ocr')

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

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

/** Whether ticket reading is available right now (the driver app hides the button otherwise). */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ available: (await ocrEngineState()) === 'up' })
}

/**
 * Queues a weighing-ticket photo for reading. The result is only ever a suggestion: the driver
 * confirms or corrects it, and uncertain readings also wait for the office (see lib/ocr/ticket).
 */
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

  // The job is only accepted once it is actually queued by a live engine: without Redis, without
  // an engine heartbeat or with the queue full it used to be answered 202 and stay "pending".
  const redis = await getRedisClient()
  if (!redis) {
    return NextResponse.json({ error: 'Service OCR indisponible, réessayez plus tard' }, { status: 503 })
  }
  if ((await ocrEngineState()) !== 'up') {
    return NextResponse.json({ error: 'Lecture automatique indisponible : saisissez le poids', code: 'OCR_ENGINE_DOWN' }, { status: 503 })
  }
  try {
    if (await redis.llen(AI_JOB_QUEUE) >= AI_JOB_QUEUE_MAX) {
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
      const item: OcrQueueItem = {
        id: job.id, type: 'ocr', tenantId,
        missionId: typeof missionId === 'string' ? missionId : null,
        image: Buffer.from(buf).toString('base64'), filename: file.name,
      }
      await redis.lpush(AI_JOB_QUEUE, JSON.stringify(item))
    } catch (err) {
      log.warn('Failed to push OCR job to Redis queue', { jobId: job.id, err: String(err) })
      await db.aiJob.update({ where: { id: job.id }, data: { status: 'failed', errorMsg: 'queue_unavailable' } }).catch(() => {})
      return NextResponse.json({ error: 'Service OCR indisponible, réessayez plus tard' }, { status: 503 })
    }

    // The ticket photo is kept as evidence for whoever checks the reading (best effort).
    const type = detectDocumentType(buf)
    if (type) {
      try {
        const doc = await storeDocument(db, tenantId, {
          kind: 'WEIGHING_TICKET', data: Buffer.from(buf), filename: `ticket-${job.id}.${type.ext}`, mimeType: type.mime, ext: type.ext,
          createdBy: userId, missionId: typeof missionId === 'string' ? missionId : undefined,
        })
        await db.aiJob.update({ where: { id: job.id }, data: { inputData: { filename: file.name, size: file.size, contentType: file.type, submittedBy: userId, documentId: doc.id } } })
      } catch (err) {
        log.warn('Ticket photo not archived', { jobId: job.id, err: String(err) })
      }
    }

    log.info('OCR job created', { tenantId, jobId: job.id, missionId, size: file.size })

    return NextResponse.json({ jobId: job.id, status: 'pending' }, { status: 202 })
  } catch (err) {
    log.error('OCR job creation failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
