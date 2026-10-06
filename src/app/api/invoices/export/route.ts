import { NextResponse } from 'next/server'
import { apiRoute, unprocessable } from '@/lib/api/route'
import { buildFec, buildJournalCsv, type ExportInvoice } from '@/lib/sales/accounting'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Accounting export of the invoices and credit notes issued between `from` and `to`:
 * `format=fec` (Fichier des écritures comptables) or `format=csv` (sales journal for Sage & co).
 * Marks them as exported.
 */
export const GET = apiRoute({ name: '/api/invoices/export', permission: 'manage_billing' }, async ({ db, tenantId, req }) => {
  const sp = req.nextUrl.searchParams
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  if (!DAY.test(from) || !DAY.test(to) || to < from) throw unprocessable('Période invalide (from, to au format AAAA-MM-JJ)')
  const format = sp.get('format') === 'fec' ? 'fec' : 'csv'
  const rows = await db.invoice.findMany({
    where: { status: { not: 'DRAFT' }, issueDate: { gte: from, lte: to } },
    select: { id: true, number: true, kind: true, issueDate: true, clientName: true, totalTTC: true, client: { select: { externalRef: true, id: true } }, lines: { select: { amountHT: true, vatRate: true } } },
    orderBy: { issueDate: 'asc' },
  })
  const docs: ExportInvoice[] = rows.map(r => ({
    number: r.number ?? '', kind: r.kind, issueDate: r.issueDate ?? from, clientName: r.clientName,
    clientCode: (r.client.externalRef || `C${r.client.id.slice(-8)}`).slice(0, 17), totalTTC: r.totalTTC, lines: r.lines,
  }))
  await db.invoice.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { exportedAt: new Date() } })
  const siren = (await db.tenantSettings.findUnique({ where: { tenantId }, select: { companySiret: true } }))?.companySiret.slice(0, 9) || 'SIREN'
  const body = format === 'fec' ? buildFec(docs) : buildJournalCsv(docs)
  const filename = format === 'fec' ? `${siren}FEC${to.replace(/-/g, '')}.txt` : `journal-ventes-${from}-${to}.csv`
  return new NextResponse(body, {
    headers: {
      'Content-Type': format === 'fec' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store',
    },
  })
})
