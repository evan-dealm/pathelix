import type { TenantDb } from '@/lib/tenantDb'
import { ApiError } from '@/lib/api/route'
import { assertTenantRefs } from '@/lib/tenantRefs'
import { applyDocumentAdjustments, computeTotals, priceItems, round2, type BillableItem, type PricedLine } from '@/lib/pricing/engine'
import { loadRules } from '@/lib/pricing/load'
import { nextNumber } from './numbering'
import { addDaysIso, buildLines, daysBetween, isoDay, type StoredLine } from './lines'
import type { SalesLineInput } from './schemas'
import { commercialSettings, assertLineRefs } from './quotes'

/** Status shown to people: an unpaid invoice past its due date is overdue. */
export function effectiveInvoiceStatus(inv: { status: string; dueDate: string | null; totalTTC: number; amountPaid: number }, today = isoDay()): string {
  const open = inv.status === 'ISSUED' || inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID'
  if (open && inv.dueDate && inv.dueDate < today && round2(inv.totalTTC - inv.amountPaid) > 0) return 'OVERDUE'
  return inv.status
}

export function balanceOf(inv: { totalTTC: number; amountPaid: number }): number {
  return round2(inv.totalTTC - inv.amountPaid)
}

interface FieldDraft {
  lines:       PricedLine[]
  warnings:    string[]
  missionIds:  string[]
  weighingIds: string[]
}

/** Stays of a bin at a customer, rebuilt from its history (PLACED … next movement). */
function staysFromEvents(events: Array<{ containerId: string; type: string; clientId: string | null; at: Date }>, clientId: string): Map<string, Array<{ from: string; to: string | null }>> {
  const byContainer = new Map<string, typeof events>()
  for (const e of events) byContainer.set(e.containerId, [...(byContainer.get(e.containerId) ?? []), e])
  const out = new Map<string, Array<{ from: string; to: string | null }>>()
  for (const [id, evs] of byContainer) {
    evs.sort((a, b) => a.at.getTime() - b.at.getTime())
    const stays: Array<{ from: string; to: string | null }> = []
    let open: string | null = null
    for (const e of evs) {
      const isArrival = (e.type === 'PLACED' || e.type === 'RELOCATED') && e.clientId === clientId
      const leaves = e.type === 'PICKED_UP' || e.type === 'RETURNED' || ((e.type === 'PLACED' || e.type === 'RELOCATED') && e.clientId !== clientId)
      if (isArrival && open === null) open = isoDay(e.at)
      else if (leaves && open !== null) { stays.push({ from: open, to: isoDay(e.at) }); open = null }
    }
    if (open !== null) stays.push({ from: open, to: null })
    if (stays.length > 0) out.set(id, stays)
  }
  return out
}

/**
 * Lines a customer owes for a period, from the field: completed missions (operation + transport),
 * validated weighings (treatment per tonne), bins on site (rental per day, franchise deducted per
 * stay). Anything already on a non-cancelled invoice is skipped, so nothing is billed twice.
 */
export async function billableFromField(db: TenantDb, tenantId: string, opts: { clientId: string; periodStart: string; periodEnd: string; contractId?: string | null; orderId?: string | null }): Promise<FieldDraft> {
  const { clientId, periodStart, periodEnd } = opts
  const from = new Date(`${periodStart}T00:00:00`)
  const to = new Date(`${periodEnd}T23:59:59.999`)
  const [rules, contract, missions, billedLines] = await Promise.all([
    loadRules(db, { clientId, contractId: opts.contractId, date: periodEnd }),
    opts.contractId ? db.contract.findFirst({ where: { id: opts.contractId }, select: { rentalFreeDays: true } }) : null,
    db.mission.findMany({
      where: { clientId, archived: false, completedAt: { gte: from, lte: to }, ...(opts.orderId ? { orderId: opts.orderId } : {}) },
      select: {
        id: true, type: true, date: true, priority: true, clientName: true, address: true, containerTypeId: true, materialId: true, wasteTypeLabel: true,
        placedContainer: { select: { typeId: true } }, collectedContainer: { select: { typeId: true } }, site: { select: { zipCode: true, name: true } },
      },
      orderBy: { completedAt: 'asc' },
    }),
    db.invoiceLine.findMany({
      where: { invoice: { clientId, status: { not: 'CANCELLED' }, kind: 'INVOICE' }, OR: [{ missionId: { not: null } }, { weighingId: { not: null } }, { containerId: { not: null } }] },
      select: { missionId: true, weighingId: true, containerId: true, unit: true, invoice: { select: { periodStart: true, periodEnd: true } } },
    }),
  ])
  const billedMissions = new Set(billedLines.filter(l => l.missionId && l.unit !== 'TON').map(l => l.missionId!))
  const billedWeighings = new Set(billedLines.map(l => l.weighingId).filter((x): x is string => !!x))
  const billedRental = billedLines.filter(l => l.containerId && l.unit === 'DAY')
  const s = await commercialSettings(db, tenantId)
  const lines: PricedLine[] = []
  const warnings: string[] = []
  const missionIds: string[] = []

  for (const m of missions) {
    if (billedMissions.has(m.id)) continue
    missionIds.push(m.id)
    const item: BillableItem = {
      kind: 'OPERATION', missionType: m.type, missionId: m.id,
      containerTypeId: m.containerTypeId ?? m.placedContainer?.typeId ?? m.collectedContainer?.typeId ?? undefined,
      materialId: m.materialId ?? undefined, zip: m.site?.zipCode || undefined,
      label: `${labelOf(m.type)} — ${m.site?.name || m.address} (${m.date.split('-').reverse().join('/')})`,
    }
    const r = priceItems([item], rules, { date: m.date, urgent: m.priority === 1, defaultVatRate: s.defaultVatRate }, { invoiceLevel: false })
    lines.push(...r.lines)
    warnings.push(...r.warnings)
  }

  // Treatment per tonne: validated weighings of these missions (or of this customer).
  const weighings = await db.weighing.findMany({
    where: {
      status: 'VALIDATED',
      OR: [{ missionId: { in: missions.map(m => m.id) } }, { clientId, weighedAt: { gte: from, lte: to } }],
    },
    select: { id: true, netKg: true, materialId: true, missionId: true, ticketNumber: true },
  })
  const missionMaterial = new Map(missions.map(m => [m.id, m.materialId]))
  const weighingIds: string[] = []
  for (const w of weighings) {
    if (billedWeighings.has(w.id)) continue
    weighingIds.push(w.id)
    const materialId = w.materialId ?? (w.missionId ? missionMaterial.get(w.missionId) : null) ?? undefined
    const r = priceItems([{ kind: 'TREATMENT', tons: w.netKg / 1000, materialId, weighingId: w.id, missionId: w.missionId ?? undefined, label: `Traitement${w.ticketNumber ? ` — ticket ${w.ticketNumber}` : ''}` }], rules, { defaultVatRate: s.defaultVatRate }, { invoiceLevel: false })
    lines.push(...r.lines)
    warnings.push(...r.warnings)
  }

  // Rental: each stay of a bin at this customer, cut to the period.
  const events = await db.containerEvent.findMany({
    where: { container: { OR: [{ clientId }, { events: { some: { clientId } } }] }, type: { in: ['PLACED', 'RELOCATED', 'PICKED_UP', 'RETURNED'] }, at: { lte: to } },
    select: { containerId: true, type: true, clientId: true, at: true },
  })
  const stays = staysFromEvents(events, clientId)
  if (stays.size > 0) {
    const containers = await db.container.findMany({ where: { id: { in: [...stays.keys()] } }, select: { id: true, number: true, typeId: true, type: { select: { name: true, dailyRentalPrice: true } } } })
    const freeDays = contract?.rentalFreeDays ?? undefined
    for (const c of containers) {
      for (const stay of stays.get(c.id) ?? []) {
        const stayEnd = stay.to ?? periodEnd
        const start = stay.from > periodStart ? stay.from : periodStart
        const end = stayEnd < periodEnd ? stayEnd : periodEnd
        const days = daysBetween(start, end) + (stay.to === null || stay.to > periodEnd ? 1 : 0)
        if (days <= 0) continue
        const already = billedRental.some(l => l.containerId === c.id && l.invoice.periodStart && l.invoice.periodEnd && l.invoice.periodStart <= end && l.invoice.periodEnd >= start)
        if (already) continue
        // Franchise counts from the start of the stay: days of the stay before this period consumed it.
        const consumed = Math.max(0, daysBetween(stay.from, start))
        const r = priceItems([{
          kind: 'RENTAL', containerTypeId: c.typeId, days, containerId: c.id, fallbackDailyPrice: c.type.dailyRentalPrice,
          freeDays: freeDays !== undefined ? Math.max(0, freeDays - consumed) : undefined,
          label: `Location ${c.type.name} n° ${c.number} du ${start.split('-').reverse().join('/')} au ${end.split('-').reverse().join('/')}`,
        }], rules, { defaultVatRate: s.defaultVatRate }, { invoiceLevel: false })
        lines.push(...r.lines)
        warnings.push(...r.warnings)
      }
    }
  }

  lines.push(...applyDocumentAdjustments(lines, rules, s.defaultVatRate))
  return { lines, warnings: [...new Set(warnings)], missionIds, weighingIds }
}

const TYPE_LABEL: Record<string, string> = {
  POSER: 'Pose', RETIRER: 'Retrait', ECHANGER: 'Échange', ALLER_RETOUR: 'Rotation', CHARGER_IMMEDIAT: 'Chargement', DEPLACER: 'Déplacement', TASSER: 'Tassage', EXPEDIER: 'Expédition',
}
function labelOf(type: string): string { return TYPE_LABEL[type] ?? type }

function storedFromPriced(l: PricedLine, i: number): StoredLine & { missionId: string | null; containerId: string | null; weighingId: string | null } {
  return {
    position: i, label: l.label, description: '', quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, discountPct: l.discountPct,
    vatRate: l.vatRate, amountHT: l.amountHT, explanation: l.explanation, missionType: l.missionType ?? null,
    containerTypeId: l.containerTypeId ?? null, materialId: l.materialId ?? null, plannedDate: null,
    missionId: l.missionId ?? null, containerId: l.containerId ?? null, weighingId: l.weighingId ?? null,
  }
}

export async function createInvoiceDraft(db: TenantDb, tenantId: string, userId: string, input: {
  clientId: string; orderId?: string | null; contractId?: string | null; periodStart?: string; periodEnd?: string; fromFieldData?: boolean; notes?: string; lines?: SalesLineInput[]
}): Promise<{ invoice: { id: string }; warnings: string[] }> {
  await assertTenantRefs(db, { clientId: input.clientId, orderId: input.orderId ?? undefined, contractId: input.contractId ?? undefined })
  if (input.lines) await assertLineRefs(db, input.lines)
  const s = await commercialSettings(db, tenantId)
  let stored: Array<ReturnType<typeof storedFromPriced>> = []
  let warnings: string[] = []
  if (input.fromFieldData) {
    if (!input.periodStart || !input.periodEnd) throw new ApiError(422, 'Période requise pour facturer les prestations', 'PERIOD')
    if (input.periodEnd < input.periodStart) throw new ApiError(422, 'La fin de période précède le début', 'PERIOD')
    const draft = await billableFromField(db, tenantId, { clientId: input.clientId, periodStart: input.periodStart, periodEnd: input.periodEnd, contractId: input.contractId, orderId: input.orderId })
    if (draft.lines.length === 0) throw new ApiError(422, 'Rien à facturer sur cette période : aucune prestation terminée, pesée ou location non facturée', 'NOTHING')
    stored = draft.lines.map(storedFromPriced)
    warnings = draft.warnings
  }
  if (input.lines?.length) {
    const manual = buildLines(input.lines, s.defaultVatRate).lines
    stored.push(...manual.map((l, i) => ({ ...l, position: stored.length + i, missionId: null, containerId: null, weighingId: null })))
  }
  const totals = computeTotals(stored)
  const invoice = await db.invoice.create({
    data: {
      kind: 'INVOICE', clientId: input.clientId, orderId: input.orderId ?? null, contractId: input.contractId ?? null, status: 'DRAFT',
      periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null, notes: input.notes ?? '',
      totalHT: totals.totalHT, totalVAT: totals.totalVAT, totalTTC: totals.totalTTC, createdBy: userId,
      lines: { create: stored.map(l => ({ ...l, plannedDate: undefined, missionType: undefined, containerTypeId: undefined, materialId: undefined, tenantId })) },
    } as Parameters<typeof db.invoice.create>[0]['data'],
    select: { id: true },
  })
  return { invoice, warnings }
}

export async function updateInvoiceDraft(db: TenantDb, tenantId: string, id: string, input: { notes?: string; dueDate?: string; lines?: SalesLineInput[] }) {
  const inv = await db.invoice.findFirst({ where: { id }, select: { status: true, lines: { select: { missionId: true, containerId: true, weighingId: true, position: true } } } })
  if (!inv) throw new ApiError(404, 'Facture introuvable', 'NOT_FOUND')
  if (inv.status !== 'DRAFT') throw new ApiError(422, 'Une facture émise ne se modifie plus : faites un avoir', 'NOT_DRAFT')
  if (input.lines) await assertLineRefs(db, input.lines)
  return db.$transaction(async tx => {
    const data: Record<string, unknown> = {}
    if (input.notes !== undefined) data.notes = input.notes
    if (input.dueDate !== undefined) data.dueDate = input.dueDate
    if (input.lines) {
      const s = await commercialSettings(tx as unknown as TenantDb, tenantId)
      const { lines, totals } = buildLines(input.lines, s.defaultVatRate)
      // Keep the field references of lines that stay at the same position (traceability).
      const refs = new Map(inv.lines.map(l => [l.position, l]))
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } })
      await tx.invoiceLine.createMany({ data: lines.map(l => ({
        position: l.position, label: l.label, description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice,
        discountPct: l.discountPct, vatRate: l.vatRate, amountHT: l.amountHT, explanation: l.explanation, invoiceId: id,
        missionId: refs.get(l.position)?.missionId ?? null, containerId: refs.get(l.position)?.containerId ?? null, weighingId: refs.get(l.position)?.weighingId ?? null,
      })) as Parameters<typeof tx.invoiceLine.createMany>[0]['data'] })
      Object.assign(data, { totalHT: totals.totalHT, totalVAT: totals.totalVAT, totalTTC: totals.totalTTC })
    }
    return tx.invoice.update({ where: { id }, data })
  })
}

/**
 * Issues a draft: gap-free number (taken in this transaction), issue and due dates, snapshot of
 * the customer's legal details. Lines still waiting for a price block the issue.
 */
export async function issueInvoice(db: TenantDb, tenantId: string, id: string) {
  const inv = await db.invoice.findFirst({
    where: { id },
    include: { lines: true, client: { select: { name: true, billingAddress: true, siret: true, paymentTermsDays: true } }, contract: { select: { paymentTermsDays: true } } },
  })
  if (!inv) throw new ApiError(404, 'Facture introuvable', 'NOT_FOUND')
  if (inv.status !== 'DRAFT') throw new ApiError(422, 'Facture déjà émise', 'NOT_DRAFT')
  if (inv.lines.length === 0) throw new ApiError(422, 'Une facture sans ligne ne peut pas être émise', 'EMPTY')
  const unpriced = inv.lines.filter(l => l.unitPrice === 0 && /prix à saisir/.test(l.explanation))
  if (unpriced.length > 0) throw new ApiError(422, `${unpriced.length} ligne(s) sans prix : complétez-les avant d'émettre`, 'UNPRICED', unpriced.map(l => l.label))
  const s = await commercialSettings(db, tenantId)
  const issueDate = isoDay()
  const terms = inv.contract?.paymentTermsDays ?? inv.client.paymentTermsDays ?? 30
  return db.$transaction(async tx => {
    const number = await nextNumber(tx, tenantId, inv.kind === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE', inv.kind === 'CREDIT_NOTE' ? s.creditNotePrefix : s.invoicePrefix)
    const issued = await tx.invoice.update({
      where: { id },
      data: {
        number, status: 'ISSUED', issueDate, dueDate: inv.dueDate ?? addDaysIso(issueDate, terms),
        clientName: inv.client.name, billingAddress: inv.client.billingAddress, clientSiret: inv.client.siret,
      },
    })
    // A credit note that cancels the whole invoice closes it.
    if (inv.kind === 'CREDIT_NOTE' && inv.creditedInvoiceId) {
      const original = await tx.invoice.findFirst({ where: { id: inv.creditedInvoiceId }, select: { totalTTC: true } })
      const credited = await tx.invoice.aggregate({ where: { creditedInvoiceId: inv.creditedInvoiceId, kind: 'CREDIT_NOTE', status: { not: 'DRAFT' } }, _sum: { totalTTC: true } })
      if (original && round2(original.totalTTC + (credited._sum.totalTTC ?? 0)) <= 0) {
        await tx.invoice.update({ where: { id: inv.creditedInvoiceId }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
      }
    }
    return issued
  })
}

/** Credit note for an issued invoice — all its lines (negated) unless specific lines are given. */
export async function createCreditNote(db: TenantDb, tenantId: string, userId: string, invoiceId: string, lines?: SalesLineInput[]) {
  const inv = await db.invoice.findFirst({ where: { id: invoiceId }, include: { lines: { orderBy: { position: 'asc' } } } })
  if (!inv) throw new ApiError(404, 'Facture introuvable', 'NOT_FOUND')
  if (inv.kind !== 'INVOICE' || inv.status === 'DRAFT') throw new ApiError(422, 'Un avoir se fait sur une facture émise', 'NOT_ISSUED')
  const s = await commercialSettings(db, tenantId)
  const src: SalesLineInput[] = lines ?? inv.lines.map(l => ({ label: l.label, quantity: -l.quantity, unit: l.unit as SalesLineInput['unit'], unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: l.vatRate, explanation: `Avoir sur ${inv.number}` }))
  const built = buildLines(src.map(l => ({ ...l, quantity: -Math.abs(l.quantity) })), s.defaultVatRate)
  return db.invoice.create({
    data: {
      kind: 'CREDIT_NOTE', creditedInvoiceId: inv.id, clientId: inv.clientId, orderId: inv.orderId, contractId: inv.contractId, status: 'DRAFT',
      notes: `Avoir sur la facture ${inv.number}`, totalHT: built.totals.totalHT, totalVAT: built.totals.totalVAT, totalTTC: built.totals.totalTTC, createdBy: userId,
      // A full credit keeps each line's mission / bin / weighing, so per-mission revenue
      // (profitability) is net of what was credited.
      lines: { create: built.lines.map((l, i) => ({
        position: l.position, label: l.label, description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: l.vatRate, amountHT: l.amountHT, explanation: l.explanation, tenantId,
        ...(lines ? {} : { missionId: inv.lines[i]?.missionId ?? null, containerId: inv.lines[i]?.containerId ?? null, weighingId: inv.lines[i]?.weighingId ?? null }),
      })) },
    } as Parameters<typeof db.invoice.create>[0]['data'],
  })
}

/** Recomputes paid amount and status of an invoice from its payments. */
export async function refreshPaymentStatus(db: Pick<TenantDb, 'invoice' | 'payment'>, invoiceId: string): Promise<void> {
  const inv = await db.invoice.findFirst({ where: { id: invoiceId }, select: { status: true, totalTTC: true, sentAt: true } })
  if (!inv || inv.status === 'DRAFT' || inv.status === 'CANCELLED') return
  const agg = await db.payment.aggregate({ where: { invoiceId }, _sum: { amount: true }, _max: { receivedAt: true } })
  const paid = round2(agg._sum.amount ?? 0)
  const status = paid <= 0 ? (inv.sentAt ? 'SENT' : 'ISSUED') : paid >= round2(inv.totalTTC) ? 'PAID' : 'PARTIALLY_PAID'
  await db.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid: paid, status, paidAt: status === 'PAID' ? new Date(`${agg._max.receivedAt ?? isoDay()}T12:00:00`) : null },
  })
}
