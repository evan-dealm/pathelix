import { apiRoute, paged, pagination, unprocessable } from '@/lib/api/route'
import { assertTenantRefs } from '@/lib/tenantRefs'
import { DOCUMENT_KINDS, detectDocumentType, storeDocument, type DocumentKind } from '@/lib/documents/archive'

const MAX_BYTES = 5 * 1024 * 1024
const LINKS = ['clientId', 'missionId', 'quoteId', 'orderId', 'invoiceId', 'contractId', 'weighingId', 'containerId'] as const

/** Documents of the tenant, filtered by what they belong to (clientId, missionId, invoiceId…). */
export const GET = apiRoute({ name: '/api/documents' }, async ({ db, req }) => {
  const { page, limit, skip } = pagination(req)
  const sp = req.nextUrl.searchParams
  const where: Record<string, unknown> = {}
  for (const k of LINKS) if (sp.get(k)) where[k] = sp.get(k)
  if (sp.get('kind')) where.kind = sp.get('kind')
  const [rows, total] = await Promise.all([
    db.document.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, filename: true, mimeType: true, sizeBytes: true, visibleToClient: true, createdAt: true, clientId: true, missionId: true, invoiceId: true, quoteId: true, contractId: true, weighingId: true, containerId: true } }),
    db.document.count({ where }),
  ])
  return paged(rows, total, page, limit)
})

/**
 * Upload (multipart: file, kind, links, visibleToClient). Only PDF and images, checked on the
 * bytes; stored through the storage backend, never under public/.
 */
export const POST = apiRoute({ name: '/api/documents', permission: 'manage_missions' }, async ({ db, tenantId, userId, req }) => {
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) throw unprocessable('Fichier manquant', 'NO_FILE')
  if (file.size > MAX_BYTES) throw unprocessable('Fichier trop volumineux (5 Mo maximum)', 'TOO_LARGE')
  const data = Buffer.from(await file.arrayBuffer())
  const type = detectDocumentType(data)
  if (!type) throw unprocessable('Format non accepté : PDF, JPEG, PNG ou WebP', 'BAD_TYPE')
  const kindRaw = String(form.get('kind') ?? 'OTHER')
  const kind = (DOCUMENT_KINDS as readonly string[]).includes(kindRaw) ? kindRaw as DocumentKind : 'OTHER'
  const links: Record<string, string> = {}
  for (const k of LINKS) { const v = form.get(k); if (typeof v === 'string' && v) links[k] = v }
  await assertTenantRefs(db, links)
  const doc = await storeDocument(db, tenantId, {
    kind, data, filename: file.name || `document.${type.ext}`, mimeType: type.mime, ext: type.ext, createdBy: userId,
    visibleToClient: form.get('visibleToClient') === 'true', ...links,
  })
  return { id: doc.id, filename: doc.filename, kind: doc.kind }
})
