import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq'
import type { TourPdfProps } from '@/lib/tourPdf'
import type { MonthlyReportData } from '@/lib/pdfReport'
import { queueConnectionOptions, workerConnectionOptions, withTimeout } from './connection'

export type PdfJobData =
  | { kind: 'tour';   tenantId: string; props: TourPdfProps }
  | { kind: 'report'; tenantId: string; data:  MonthlyReportData }

export interface PdfJobResult {
  base64: string
}

export const PDF_QUEUE_NAME = 'pdf-generation'

let _pdfQueue: Queue<PdfJobData, PdfJobResult> | null = null
let _pdfQueueEvents: QueueEvents | null = null


export function getPdfQueue(): Queue<PdfJobData, PdfJobResult> {
  if (!_pdfQueue) {
    _pdfQueue = new Queue<PdfJobData, PdfJobResult>(PDF_QUEUE_NAME, {
      connection:        queueConnectionOptions() as ConnectionOptions,
      defaultJobOptions: {
        attempts:         2,
        backoff:          { type: 'fixed', delay: 1_000 },
        removeOnComplete: { count: 100 },
        removeOnFail:     { count: 50  },
      },
    })
    _pdfQueue.on('error', () => {})
  }
  return _pdfQueue
}

function getPdfQueueEvents(): QueueEvents {
  if (!_pdfQueueEvents) {
    // QueueEvents uses blocking stream reads: it needs the worker-style connection.
    _pdfQueueEvents = new QueueEvents(PDF_QUEUE_NAME, { connection: workerConnectionOptions() as ConnectionOptions })
    _pdfQueueEvents.on('error', () => {})
  }
  return _pdfQueueEvents
}

/**
 * Enqueues a PDF job and blocks until it completes (or times out) — unlike VRP's async
 * job-id + client poll pattern, these routes are a plain `GET` that must return the finished
 * PDF bytes directly in one response. Rendering itself takes well under a second; the timeout
 * exists only to bound how long a request can hang if the worker is stuck or the queue backs up.
 */
export async function generatePdfViaWorker(
  data:      PdfJobData,
  timeoutMs = 20_000,
): Promise<Buffer> {
  const queue = getPdfQueue()
  const job = await withTimeout(queue.add(data.kind, data, {
    jobId: `${data.kind}:${data.tenantId}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }), 3_000, 'enqueue PDF job')

  const result = await job.waitUntilFinished(getPdfQueueEvents(), timeoutMs)
  return Buffer.from(result.base64, 'base64')
}
