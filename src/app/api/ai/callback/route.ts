import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { unscopedPrisma } from '@/lib/tenantDb'

const log = createLogger('/api/ai/callback')

const AI_CALLBACK_SECRET = process.env.AI_CALLBACK_SECRET ?? ''

async function verifyHmacSignature(body: string, signature: string): Promise<boolean> {
  if (!AI_CALLBACK_SECRET) {
    log.warn('AI_CALLBACK_SECRET not set — rejecting all callbacks')
    return false
  }

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(AI_CALLBACK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const expected = Buffer.from(mac).toString('hex')

  // timingSafeEqual via crypto.subtle compare
  const expectedBuf = encoder.encode(expected)
  const receivedBuf = encoder.encode(signature)
  if (expectedBuf.length !== receivedBuf.length) return false

  // Use timingSafeEqual via Node.js crypto
  const { timingSafeEqual } = await import('crypto')
  return timingSafeEqual(
    Buffer.from(expectedBuf),
    Buffer.from(receivedBuf),
  )
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const signature = req.headers.get('x-ai-signature') ?? ''
  const rawBody = await req.text()

  const valid = await verifyHmacSignature(rawBody, signature)
  if (!valid) {
    log.warn('AI callback signature invalid', { signature: signature.slice(0, 16) })
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  if (
    typeof payload !== 'object' || payload === null ||
    typeof (payload as Record<string, unknown>).jobId !== 'string' ||
    typeof (payload as Record<string, unknown>).status !== 'string'
  ) {
    return NextResponse.json({ error: 'Payload invalide (jobId + status requis)' }, { status: 422 })
  }

  const { jobId, status, result, error: errMsg } = payload as {
    jobId: string
    status: string
    result?: Record<string, unknown>
    error?: string
  }

  if (!['done', 'failed'].includes(status)) {
    return NextResponse.json({ error: 'Status invalide (done|failed)' }, { status: 422 })
  }

  try {
    // Webhook authenticated by AI_CALLBACK_SECRET (HMAC), not by tenant context — the AI engine
    // knows only jobId, so this must stay unscoped, same as the Nessy/OBD/Geotab webhooks.
    const job = await unscopedPrisma.aiJob.findUnique({ where: { id: jobId } })
    if (!job) {
      return NextResponse.json({ error: 'Job introuvable' }, { status: 404 })
    }

    // Idempotent: ignore duplicate callbacks for already-completed jobs
    if (job.status === 'done' || job.status === 'failed') {
      return NextResponse.json({ ok: true, ignored: true })
    }

    await unscopedPrisma.aiJob.update({
      where: { id: jobId },
      data: {
        status,
        outputData: result ? (result as import('@/generated/prisma').Prisma.InputJsonValue) : undefined,
        errorMsg:   errMsg ?? undefined,
      },
    })

    log.info('AI job updated via callback', { jobId, status })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('AI callback processing failed', { err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
