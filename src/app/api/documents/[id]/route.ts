import { NextResponse } from 'next/server'
import { apiRoute, notFound } from '@/lib/api/route'
import { hasPermission } from '@/lib/permissions'
import { readDocument } from '@/lib/documents/archive'
import { getStorage } from '@/lib/storage'

const FINANCIAL = new Set(['INVOICE_PDF', 'CREDIT_NOTE_PDF'])

/** Download (tenant-scoped; invoices need the billing permission). Sent as an attachment. */
export const GET = apiRoute({ name: '/api/documents/[id]' }, async ({ db, userId, role, params }) => {
  const d = await db.document.findFirst({ where: { id: params.id } })
  if (!d) throw notFound('Document')
  if (FINANCIAL.has(d.kind) && !(await hasPermission(userId, role, 'manage_billing'))) {
    return NextResponse.json({ error: 'Permission refusée', code: 'FORBIDDEN' }, { status: 403 })
  }
  const bytes = await readDocument(d.storageKey)
  if (!bytes) throw notFound('Fichier')
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': d.mimeType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${d.mimeType === 'application/pdf' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(d.filename)}"`,
    },
  })
})

export const PUT = apiRoute({ name: '/api/documents/[id]', permission: 'manage_missions' }, async ({ db, req, params }) => {
  const d = await db.document.findFirst({ where: { id: params.id }, select: { id: true } })
  if (!d) throw notFound('Document')
  const body = await req.json().catch(() => ({})) as { visibleToClient?: unknown }
  if (typeof body.visibleToClient !== 'boolean') return NextResponse.json({ error: 'visibleToClient requis', code: 'VALIDATION' }, { status: 422 })
  return db.document.update({ where: { id: d.id }, data: { visibleToClient: body.visibleToClient }, select: { id: true, visibleToClient: true } })
})

/** Deletes a document; issued invoices' PDFs are kept (legal archive). */
export const DELETE = apiRoute({ name: '/api/documents/[id]', permission: 'manage_missions' }, async ({ db, params }) => {
  const d = await db.document.findFirst({ where: { id: params.id }, select: { id: true, kind: true, storageKey: true } })
  if (!d) throw notFound('Document')
  if (FINANCIAL.has(d.kind)) return NextResponse.json({ error: 'Les PDF de factures sont conservés (archive légale)', code: 'LEGAL_ARCHIVE' }, { status: 422 })
  await db.document.delete({ where: { id: d.id } })
  await getStorage().delete(d.storageKey).catch(() => undefined)
  return { ok: true }
})
