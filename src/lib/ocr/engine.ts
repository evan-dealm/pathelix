import { getRedisClient } from '@/lib/redisClient'

/**
 * Contract with the OCR engine (ai-engine/, Python + Tesseract):
 * - jobs are LPUSHed on AI_JOB_QUEUE as `{ id, type: 'ocr', tenantId, missionId, image (base64), filename }`;
 * - the engine refreshes ENGINE_HEARTBEAT_KEY (TTL 60 s) while it consumes the queue;
 * - results come back signed on /api/ai/callback as `{ jobId, status: 'done'|'failed', result: { text, lines, meanConfidence } }`.
 *
 * The heartbeat is the circuit breaker: without a live engine no image is queued (it would sit
 * there for nothing) and the driver is offered the manual form straight away.
 */
export const AI_JOB_QUEUE = 'ai-jobs:pending'
export const ENGINE_HEARTBEAT_KEY = 'ai-engine:heartbeat'
/** Each entry holds a base64 image (up to ~7 MB): cap the backlog. */
export const AI_JOB_QUEUE_MAX = 200

export interface OcrQueueItem { id: string; type: 'ocr'; tenantId: string; missionId: string | null; image: string; filename: string }

type EngineState = 'up' | 'down' | 'no-redis'

/** Whether an OCR engine is consuming the queue right now. */
export async function ocrEngineState(): Promise<EngineState> {
  const redis = await getRedisClient()
  if (!redis) return 'no-redis'
  try {
    return (await redis.exists(ENGINE_HEARTBEAT_KEY)) ? 'up' : 'down'
  } catch {
    return 'no-redis'
  }
}
