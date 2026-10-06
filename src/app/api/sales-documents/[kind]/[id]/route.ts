import { NextResponse } from 'next/server'
import { apiRoute, unprocessable } from '@/lib/api/route'
import { hasPermission } from '@/lib/permissions'
import { loadSalesDocument, renderSalesHtml } from '@/lib/sales/document'
import { salesPdf } from '@/lib/sales/delivery'

/**
 * A quote or invoice as a document: `?format=pdf` (PDF worker) or the printable HTML (always
 * available). Quotes need "manage_sales", invoices "manage_billing".
 */
export const GET = apiRoute({ name: '/api/sales-documents/[kind]/[id]' }, async ({ db, tenantId, userId, role, req, params }) => {
  const kind = params.kind === 'quote' ? 'QUOTE' : params.kind === 'invoice' ? 'INVOICE' : null
  if (!kind) throw unprocessable('Type de document inconnu')
  const perm = kind === 'QUOTE' ? 'manage_sales' : 'manage_billing'
  if (!(await hasPermission(userId, role, perm))) return NextResponse.json({ error: 'Permission refusée', code: 'FORBIDDEN' }, { status: 403 })
  const data = await loadSalesDocument(db, tenantId, kind, params.id)
  const filename = data.number.replace(/[^A-Za-z0-9_-]/g, '_')
  if (req.nextUrl.searchParams.get('format') === 'pdf') {
    const pdf = await salesPdf(tenantId, data)
    if (!pdf) return NextResponse.json({ error: 'Le service PDF est arrêté : utilisez la version imprimable (Ctrl+P)', code: 'PDF_UNAVAILABLE' }, { status: 503 })
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}.pdf"`, 'Cache-Control': 'private, no-store' },
    })
  }
  return new NextResponse(renderSalesHtml(data), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } })
})
