import dotenv from 'dotenv'
dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })
import { validateEnv } from '@/lib/env'
validateEnv()
import { Worker, type Job } from 'bullmq'
import { PDF_QUEUE_NAME, type PdfJobData, type PdfJobResult } from '@/lib/queue/pdfQueue'
import { workerRedisConnection, REDIS_URL } from '@/lib/queue/connection'
import { renderTourPdf } from '@/lib/tourPdf'
import { generateMonthlyReportPdf } from '@/lib/pdfReport'
import { createLogger } from '@/lib/logger'

const log = createLogger('pdfWorker')

// Rendering here — a standalone process, not bundled by Next's webpack build for the route
// handler — is the whole point of this worker: @react-pdf/renderer's own React instance can
// never collide with Next's here, since there is no Next instance in this process at all. That
// dual-package hazard (see docs/deploiement.md §4) is what made in-process rendering crash
// under `/api/tours/pdf` and `/api/reports/pdf` in the first place.
async function processJob(job: Job<PdfJobData, PdfJobResult>): Promise<PdfJobResult> {
  const data = job.data
  const elapsed = log.timer()

  const buffer = data.kind === 'tour'
    ? await renderTourPdf(data.props)
    : await generateMonthlyReportPdf(data.data)

  log.info('PDF generated', { jobId: job.id, kind: data.kind, tenantId: data.tenantId, ms: elapsed(), bytes: buffer.length })

  return { base64: buffer.toString('base64') }
}

const concurrency = parseInt(process.env.PDF_CONCURRENCY ?? '2', 10) || 2
const conn = REDIS_URL ? { url: REDIS_URL } : workerRedisConnection

const worker = new Worker<PdfJobData, PdfJobResult>(
  PDF_QUEUE_NAME,
  processJob,
  {
    connection:   conn as never,
    concurrency,
    lockDuration: 30_000,
  },
)

worker.on('completed', job => {
  log.info('Job completed', { jobId: job.id })
})

worker.on('failed', (job, err) => {
  log.error('Job failed', { jobId: job?.id, err: err instanceof Error ? err.message : String(err) })
})

worker.on('error', err => {
  log.error('Worker error', { err: err instanceof Error ? err.message : String(err) })
})

async function shutdown(): Promise<void> {
  log.info('Worker shutting down…')
  await worker.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)

log.info('PDF Worker started', { queue: PDF_QUEUE_NAME, concurrency })
