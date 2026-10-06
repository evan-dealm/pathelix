// Unlike the other workers, this one is run via `npm run build:worker:pdf && node
// dist/workers/pdfWorker.mjs` (see package.json), not `tsx` directly. `tsx`'s tsconfig-paths
// resolver hook falls back to Node's CJS module resolution algorithm for every import in the
// process once "paths" is configured — including deep in @react-pdf/renderer's own dependency
// chain — and @react-pdf/hyphenate's package.json only declares an "import" export condition,
// so that CJS-style resolution throws ERR_PACKAGE_PATH_NOT_EXPORTED before this file's own code
// ever runs. esbuild resolves our `@/` aliases and inlines our own source at build time, leaving
// only real npm packages as bare imports for Node's own (correct) ESM resolver to handle.
import dotenv from 'dotenv'
dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })
import { validateEnv } from '@/lib/env'
validateEnv()
import { Worker, type Job } from 'bullmq'
import { PDF_QUEUE_NAME, type PdfJobData, type PdfJobResult } from '@/lib/queue/pdfQueue'
import { workerConnectionOptions } from '@/lib/queue/connection'
import { installWorkerLifecycle } from './lifecycle'
import { renderTourPdf } from '@/lib/tourPdf'
import { generateMonthlyReportPdf } from '@/lib/pdfReport'
import { renderSalesPdf } from '@/lib/salesPdf'
import { createLogger } from '@/lib/logger'

const log = createLogger('pdfWorker')

// Rendering here — a standalone process, not bundled by Next's webpack build for the route
// handler — is the whole point of this worker: @react-pdf/renderer's own React instance can
// never collide with Next's here, since there is no Next instance in this process at all. That
// dual-package hazard (see ARCHITECTURE.md §7) is what made in-process rendering crash
// under `/api/tours/pdf` and `/api/reports/pdf` in the first place.
async function processJob(job: Job<PdfJobData, PdfJobResult>): Promise<PdfJobResult> {
  const data = job.data
  const elapsed = log.timer()

  const buffer = data.kind === 'tour'
    ? await renderTourPdf(data.props)
    : data.kind === 'sales'
      ? await renderSalesPdf(data.data)
      : await generateMonthlyReportPdf(data.data)

  log.info('PDF generated', { jobId: job.id, kind: data.kind, tenantId: data.tenantId, ms: elapsed(), bytes: buffer.length })

  return { base64: buffer.toString('base64') }
}

const concurrency = parseInt(process.env.PDF_CONCURRENCY ?? '2', 10) || 2

const worker = new Worker<PdfJobData, PdfJobResult>(
  PDF_QUEUE_NAME,
  processJob,
  {
    connection:   workerConnectionOptions() as never,
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

installWorkerLifecycle(log, [() => worker.close()])

log.info('PDF Worker started', { queue: PDF_QUEUE_NAME, concurrency })
