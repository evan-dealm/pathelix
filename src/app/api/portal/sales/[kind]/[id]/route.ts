import { NextResponse } from 'next/server'
import { portalRoute } from '@/lib/portal/route'
import { loadSalesDocument, renderSalesHtml } from '@/lib/sales/document'
import { salesPdf } from '@/lib/sales/delivery'

/** The customer's own quote (sent or answered) or invoice (issued): printable HTML or `?format=pdf`. */
export const GET = portalRoute({ name: '/api/portal/sales/[kind]/[id]' }, async ({ db, session, req, params }) => {
  const kind = params.kind === 'quote' ? 'QUOTE' : params.kind === 'invoice' ? 'INVOICE' : null
  const owned = kind === 'QUOTE'
    ? await db.quote.findFirst({ where: { id: params.id, clientId: session.clientId, status: { not: 'DRAFT' } }, select: { id: true } })
    : kind === 'INVOICE'
      ? await db.invoice.findFirst({ where: { id: params.id, clientId: session.clientId, status: { not: 'DRAFT' } }, select: { id: true } })
      : null
  if (!kind || !owned) return NextResponse.json({ error: 'Document introuvable' }, { status: 404 })
  const data = await loadSalesDocument(db, session.tenantId, kind, params.id)
  if (req.nextUrl.searchParams.get('format') === 'pdf') {
    const pdf = await salesPdf(session.tenantId, data)
    if (!pdf) return NextResponse.json({ error: 'PDF momentanément indisponible : utilisez la version imprimable' }, { status: 503 })
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${data.number.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf"`, 'Cache-Control': 'private, no-store' } })
  }
  return new NextResponse(renderSalesHtml(data), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } })
})
