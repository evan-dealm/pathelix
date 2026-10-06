import { createHash, randomUUID } from 'crypto'
import type { TenantDb } from '@/lib/tenantDb'
import { getStorage } from '@/lib/storage'
import { detectImageExt } from '@/lib/uploadStorage'
import { createLogger } from '@/lib/logger'
import { loadSalesDocument } from '@/lib/sales/document'
import { salesPdf } from '@/lib/sales/delivery'

const log = createLogger('documents')

export const DOCUMENT_KINDS = ['QUOTE_PDF', 'INVOICE_PDF', 'CREDIT_NOTE_PDF', 'CONTRACT', 'WEIGHING_TICKET', 'PHOTO', 'SIGNATURE', 'BSD', 'PROOF', 'REPORT', 'OTHER'] as const
export type DocumentKind = typeof DOCUMENT_KINDS[number]

export interface DocumentLinks {
  clientId?: string | null; missionId?: string | null; quoteId?: string | null; orderId?: string | null
  invoiceId?: string | null; contractId?: string | null; weighingId?: string | null; containerId?: string | null
}

/** Real type of an uploaded file from its bytes (never the declared MIME): PDF or image. */
export function detectDocumentType(buf: Uint8Array): { ext: string; mime: string } | null {
  if (buf.length >= 5 && Buffer.from(buf.subarray(0, 5)).toString('ascii') === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' }
  const img = detectImageExt(buf)
  if (!img) return null
  return { ext: img, mime: img === 'jpg' ? 'image/jpeg' : `image/${img}` }
}

/** Stores bytes in the storage backend and records the document with what it belongs to. */
export async function storeDocument(db: TenantDb, tenantId: string, input: {
  kind: DocumentKind; data: Buffer; filename: string; mimeType: string; ext: string; createdBy: string; visibleToClient?: boolean
} & DocumentLinks) {
  const year = new Date().getFullYear()
  const key = `${tenantId}/documents/${year}/${randomUUID()}.${input.ext}`
  await getStorage().put(key, input.data, input.mimeType)
  const { data, ext: _ext, ...rest } = input
  void _ext
  return db.document.create({
    data: {
      ...rest, storageKey: key, filename: input.filename.replace(/[\r\n"]/g, '').slice(0, 200), sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'), visibleToClient: input.visibleToClient ?? false,
    } as Parameters<typeof db.document.create>[0]['data'],
  })
}

export async function readDocument(storageKey: string): Promise<Buffer | null> {
  return getStorage().get(storageKey)
}

/**
 * Keeps the PDF of an issued invoice (or a sent quote) as a document, visible in the customer
 * portal. Best effort: when the PDF worker is down the document is generated on demand later.
 */
export async function archiveSalesPdf(db: TenantDb, tenantId: string, userId: string, kind: 'QUOTE' | 'INVOICE', id: string): Promise<void> {
  try {
    const data = await loadSalesDocument(db, tenantId, kind, id)
    const pdf = await salesPdf(tenantId, data)
    if (!pdf) return
    const owner = kind === 'QUOTE'
      ? await db.quote.findFirst({ where: { id }, select: { clientId: true } })
      : await db.invoice.findFirst({ where: { id }, select: { clientId: true } })
    await storeDocument(db, tenantId, {
      kind: kind === 'QUOTE' ? 'QUOTE_PDF' : data.kind === 'CREDIT_NOTE' ? 'CREDIT_NOTE_PDF' : 'INVOICE_PDF',
      data: pdf, filename: `${data.number}.pdf`, mimeType: 'application/pdf', ext: 'pdf', createdBy: userId, visibleToClient: true,
      clientId: owner?.clientId ?? null, ...(kind === 'QUOTE' ? { quoteId: id } : { invoiceId: id }),
    })
  } catch (err) {
    log.warn('PDF archive failed', { kind, id, err: err instanceof Error ? err.message : String(err) })
  }
}
