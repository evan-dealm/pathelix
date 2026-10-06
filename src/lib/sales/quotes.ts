import type { TenantDb } from '@/lib/tenantDb'
import { ApiError } from '@/lib/api/route'
import { assertTenantRefs } from '@/lib/tenantRefs'
import { nextNumber } from './numbering'
import { addDaysIso, buildLines, isoDay } from './lines'
import type { SalesLineInput } from './schemas'
import { createOrderFromLines } from './orders'

export interface CommercialSettings {
  defaultVatRate:    number
  quotePrefix:       string
  orderPrefix:       string
  invoicePrefix:     string
  creditNotePrefix:  string
  quoteValidityDays: number
  defaultQuoteTerms: string
  latePaymentTerms:  string
  companyLegalName:  string
  companyAddress:    string
  companySiret:      string
  companyIban:       string
  vatNumber:         string
  displayName:       string
}

export async function commercialSettings(db: TenantDb, tenantId: string): Promise<CommercialSettings> {
  const s = await db.tenantSettings.findUnique({ where: { tenantId } })
  return {
    defaultVatRate:    s?.defaultVatRate ?? 20,
    quotePrefix:       s?.quotePrefix ?? 'DEV',
    orderPrefix:       s?.orderPrefix ?? 'CMD',
    invoicePrefix:     s?.invoicePrefix ?? 'FAC',
    creditNotePrefix:  s?.creditNotePrefix ?? 'AV',
    quoteValidityDays: s?.quoteValidityDays ?? 30,
    defaultQuoteTerms: s?.defaultQuoteTerms ?? '',
    latePaymentTerms:  s?.latePaymentTerms ?? '',
    companyLegalName:  s?.companyLegalName ?? '',
    companyAddress:    s?.companyAddress ?? '',
    companySiret:      s?.companySiret ?? '',
    companyIban:       s?.companyIban ?? '',
    vatNumber:         s?.vatNumber ?? '',
    displayName:       s?.companyDisplayName ?? '',
  }
}

/** Tenant check of every reference a line carries (bin type, material). */
export async function assertLineRefs(db: TenantDb, lines: SalesLineInput[]): Promise<void> {
  for (const l of lines) await assertTenantRefs(db, { containerTypeId: l.containerTypeId ?? undefined, materialId: l.materialId ?? undefined })
}

/** Status shown to people: a sent quote past its validity is expired even before the nightly job. */
export function effectiveQuoteStatus(q: { status: string; validUntil: string }, today = isoDay()): string {
  return q.status === 'SENT' && q.validUntil < today ? 'EXPIRED' : q.status
}

export async function createQuote(db: TenantDb, tenantId: string, userId: string, input: {
  clientId: string; siteId?: string | null; title?: string; issueDate?: string; validUntil?: string; notes?: string; terms?: string; lines: SalesLineInput[]
}) {
  await assertTenantRefs(db, { clientId: input.clientId, siteId: input.siteId ?? undefined })
  await assertLineRefs(db, input.lines)
  const s = await commercialSettings(db, tenantId)
  const issueDate = input.issueDate ?? isoDay()
  const { lines, totals } = buildLines(input.lines, s.defaultVatRate)
  return db.$transaction(async tx => {
    const number = await nextNumber(tx, tenantId, 'QUOTE', s.quotePrefix)
    return tx.quote.create({
      data: {
        number, clientId: input.clientId, siteId: input.siteId ?? null, title: input.title ?? '',
        issueDate, validUntil: input.validUntil ?? addDaysIso(issueDate, s.quoteValidityDays),
        notes: input.notes ?? '', terms: input.terms ?? s.defaultQuoteTerms,
        totalHT: totals.totalHT, totalVAT: totals.totalVAT, totalTTC: totals.totalTTC, createdBy: userId,
        lines: { create: lines.map(l => ({ ...l, tenantId })) },
      } as Parameters<typeof tx.quote.create>[0]['data'],
      include: { lines: { orderBy: { position: 'asc' } } },
    })
  })
}

/** Only a draft is edited; a sent quote must be duplicated (what the customer saw stays as is). */
export async function updateQuote(db: TenantDb, tenantId: string, id: string, input: Partial<{ siteId: string | null; title: string; issueDate: string; validUntil: string; notes: string; terms: string; lines: SalesLineInput[] }>) {
  const q = await db.quote.findFirst({ where: { id }, select: { id: true, status: true } })
  if (!q) throw new ApiError(404, 'Devis introuvable', 'NOT_FOUND')
  if (q.status !== 'DRAFT') throw new ApiError(422, 'Seul un brouillon peut être modifié — dupliquez le devis', 'NOT_DRAFT')
  await assertTenantRefs(db, { siteId: input.siteId ?? undefined })
  if (input.lines) await assertLineRefs(db, input.lines)
  const s = input.lines ? await commercialSettings(db, tenantId) : null
  return db.$transaction(async tx => {
    const data: Record<string, unknown> = {}
    for (const k of ['siteId', 'title', 'issueDate', 'validUntil', 'notes', 'terms'] as const) if (input[k] !== undefined) data[k] = input[k]
    if (input.lines && s) {
      const { lines, totals } = buildLines(input.lines, s.defaultVatRate)
      await tx.quoteLine.deleteMany({ where: { quoteId: id } })
      await tx.quoteLine.createMany({ data: lines.map(l => ({ ...l, quoteId: id })) as Parameters<typeof tx.quoteLine.createMany>[0]['data'] })
      Object.assign(data, { totalHT: totals.totalHT, totalVAT: totals.totalVAT, totalTTC: totals.totalTTC })
    }
    return tx.quote.update({ where: { id }, data, include: { lines: { orderBy: { position: 'asc' } } } })
  })
}

export async function duplicateQuote(db: TenantDb, tenantId: string, userId: string, id: string) {
  const q = await db.quote.findFirst({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } })
  if (!q) throw new ApiError(404, 'Devis introuvable', 'NOT_FOUND')
  return createQuote(db, tenantId, userId, {
    clientId: q.clientId, siteId: q.siteId, title: q.title, notes: q.notes, terms: q.terms,
    lines: q.lines.map(l => ({
      label: l.label, description: l.description, quantity: l.quantity, unit: l.unit as SalesLineInput['unit'], unitPrice: l.unitPrice,
      discountPct: l.discountPct, vatRate: l.vatRate, explanation: l.explanation, missionType: l.missionType as SalesLineInput['missionType'],
      containerTypeId: l.containerTypeId, materialId: l.materialId, plannedDate: l.plannedDate,
    })),
  })
}

export async function markQuoteSent(db: TenantDb, id: string) {
  const q = await db.quote.findFirst({ where: { id }, select: { status: true, lines: { select: { id: true }, take: 1 } } })
  if (!q) throw new ApiError(404, 'Devis introuvable', 'NOT_FOUND')
  if (q.lines.length === 0) throw new ApiError(422, 'Un devis sans ligne ne peut pas être envoyé', 'EMPTY')
  if (q.status !== 'DRAFT' && q.status !== 'SENT') throw new ApiError(422, 'Ce devis a déjà reçu une réponse', 'DECIDED')
  return db.quote.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } })
}

export async function decideQuote(db: TenantDb, id: string, decision: 'ACCEPTED' | 'REFUSED', by: string, reason = '') {
  const q = await db.quote.findFirst({ where: { id }, select: { status: true, validUntil: true } })
  if (!q) throw new ApiError(404, 'Devis introuvable', 'NOT_FOUND')
  const st = effectiveQuoteStatus(q)
  if (st === 'EXPIRED' && decision === 'ACCEPTED') throw new ApiError(422, 'Devis expiré : prolongez sa validité ou dupliquez-le', 'EXPIRED')
  if (st !== 'SENT' && st !== 'DRAFT') throw new ApiError(422, 'Ce devis a déjà reçu une réponse', 'DECIDED')
  return db.quote.update({ where: { id }, data: { status: decision, decidedAt: new Date(), decidedBy: by.slice(0, 120), refusalReason: decision === 'REFUSED' ? reason : '' } })
}

/** Accepted quote → order (same lines, same customer), optionally with its missions created now. */
export async function convertQuote(db: TenantDb, tenantId: string, userId: string, id: string, opts: { kind?: string; startDate?: string; endDate?: string | null; createMissions?: boolean }) {
  const q = await db.quote.findFirst({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } })
  if (!q) throw new ApiError(404, 'Devis introuvable', 'NOT_FOUND')
  if (q.status !== 'ACCEPTED') throw new ApiError(422, 'Seul un devis accepté devient une commande', 'NOT_ACCEPTED')
  const firstPlanned = q.lines.map(l => l.plannedDate).filter((d): d is string => !!d).sort()[0]
  const order = await createOrderFromLines(db, tenantId, userId, {
    clientId: q.clientId, siteId: q.siteId, kind: opts.kind ?? 'ONE_OFF', title: q.title || `Devis ${q.number}`,
    startDate: opts.startDate ?? firstPlanned ?? isoDay(), endDate: opts.endDate ?? null,
    notes: q.notes, lines: q.lines, createMissions: opts.createMissions ?? true,
  })
  await db.quote.update({ where: { id }, data: { status: 'CONVERTED', orderId: order.id } })
  return order
}
