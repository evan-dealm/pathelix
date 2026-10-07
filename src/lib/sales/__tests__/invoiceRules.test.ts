import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('../quotes', () => ({
  commercialSettings: vi.fn(async () => ({ invoicePrefix: 'FAC', creditNotePrefix: 'AV', defaultVatRate: 20 })),
  assertLineRefs: vi.fn(),
}))
vi.mock('../numbering', () => ({ nextNumber: vi.fn(async (_tx: unknown, _t: string, kind: string) => (kind === 'CREDIT_NOTE' ? 'AV-2026-00001' : 'FAC-2026-00001')) }))
vi.mock('@/lib/pricing/load', () => ({ loadRules: vi.fn(async () => []) }))

import { assertPayable, balanceOf, effectiveInvoiceStatus, issueInvoice, refreshPaymentStatus } from '../invoices'
import type { TenantDb } from '@/lib/tenantDb'

/** The few invoice/payment operations these rules use, over plain arrays. */
function fakeDb(invoices: Array<Record<string, unknown>>, payments: Array<{ id: string; invoiceId: string; amount: number; receivedAt?: string }> = []) {
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'not' in (v as object)) return row[k] !== (v as { not: unknown }).not
    return row[k] === v
  })
  const db = {
    invoice: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const row = invoices.find(i => matches(i, where))
        return row ? { ...row, lines: row.lines ?? [], client: row.client, contract: null } : null
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = invoices.filter(i => matches(i, where))
        for (const i of hit) Object.assign(i, data)
        return { count: hit.length }
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = invoices.find(i => i.id === where.id) as Record<string, unknown>
        Object.assign(row, data)
        return { ...row }
      }),
      aggregate: vi.fn(async ({ where }: { where: Record<string, unknown> }) => ({
        _sum: { totalTTC: invoices.filter(i => matches(i, where)).reduce((s, i) => s + Number(i.totalTTC), 0) },
      })),
    },
    payment: {
      aggregate: vi.fn(async ({ where }: { where: { invoiceId: string; id?: { not: string } } }) => {
        const rows = payments.filter(p => p.invoiceId === where.invoiceId && p.id !== where.id?.not)
        return { _sum: { amount: rows.reduce((s, p) => s + p.amount, 0) }, _max: { receivedAt: rows.map(p => p.receivedAt ?? '2026-10-07').sort().pop() ?? null } }
      }),
    },
    $transaction: vi.fn(async (fn: (_tx: unknown) => Promise<unknown>) => fn(db)),
  }
  return db as unknown as TenantDb & typeof db
}

const issued = (extra: Record<string, unknown> = {}) => ({ id: 'inv-1', clientId: 'c1', kind: 'INVOICE', status: 'ISSUED', number: 'FAC-2026-00007', totalTTC: 480, creditedTTC: 0, amountPaid: 0, sentAt: null, dueDate: '2026-11-06', ...extra })

beforeEach(() => { vi.clearAllMocks() })

describe('what remains due on an invoice', () => {
  it('is the total, less the credit notes issued against it, less what was paid', () => {
    expect(balanceOf({ totalTTC: 480, amountPaid: 100, creditedTTC: 168 })).toBe(212)
    expect(balanceOf({ totalTTC: 480, amountPaid: 100 })).toBe(380)
  })

  it('an invoice past its due date is not overdue once credit notes and payments cover it', () => {
    const base = { status: 'PARTIALLY_PAID', dueDate: '2026-01-01', totalTTC: 480, amountPaid: 312 }
    expect(effectiveInvoiceStatus({ ...base, creditedTTC: 0 }, '2026-10-07')).toBe('OVERDUE')
    expect(effectiveInvoiceStatus({ ...base, creditedTTC: 168 }, '2026-10-07')).toBe('PARTIALLY_PAID')
  })

  // Before: 484 € invoiced, 168 € credited, 316 € paid stayed "partially paid" for ever.
  it('a partly credited invoice is paid once the rest is paid', async () => {
    const inv = issued({ creditedTTC: 168 })
    const db = fakeDb([inv], [{ id: 'p1', invoiceId: 'inv-1', amount: 312 }])
    await refreshPaymentStatus(db, 'inv-1')
    expect(inv).toMatchObject({ status: 'PAID', amountPaid: 312 })
  })
})

describe('assertPayable — a payment never exceeds what remains due', () => {
  it('accepts the exact balance and anything below', async () => {
    const db = fakeDb([issued()], [{ id: 'p1', invoiceId: 'inv-1', amount: 100 }])
    await expect(assertPayable(db, 'inv-1', 'c1', 380)).resolves.toBeUndefined()
    await expect(assertPayable(db, 'inv-1', 'c1', 0.01)).resolves.toBeUndefined()
  })

  it('refuses more than the balance and says how much is left', async () => {
    const db = fakeDb([issued()], [{ id: 'p1', invoiceId: 'inv-1', amount: 100 }])
    await expect(assertPayable(db, 'inv-1', 'c1', 380.01)).rejects.toMatchObject({ status: 422, code: 'OVERPAYMENT', message: expect.stringContaining('380,00 €') })
  })

  it('counts the credit notes: the balance of a partly credited invoice is smaller', async () => {
    const db = fakeDb([issued({ creditedTTC: 168 })])
    await expect(assertPayable(db, 'inv-1', 'c1', 312)).resolves.toBeUndefined()
    await expect(assertPayable(db, 'inv-1', 'c1', 480)).rejects.toMatchObject({ code: 'OVERPAYMENT' })
  })

  it('refuses anything on an invoice already settled', async () => {
    const db = fakeDb([issued()], [{ id: 'p1', invoiceId: 'inv-1', amount: 480 }])
    await expect(assertPayable(db, 'inv-1', 'c1', 1)).rejects.toMatchObject({ code: 'OVERPAYMENT', message: expect.stringContaining('déjà soldée') })
  })

  it('takes the invoice lock before reading the balance (two simultaneous payments are decided in turn)', async () => {
    const db = fakeDb([issued()])
    await assertPayable(db, 'inv-1', 'c1', 10)
    expect(db.invoice.updateMany.mock.invocationCallOrder[0]).toBeLessThan(db.payment.aggregate.mock.invocationCallOrder[0])
  })

  it('when re-matching a payment, its own amount is not counted twice', async () => {
    const db = fakeDb([issued()], [{ id: 'p1', invoiceId: 'inv-1', amount: 480 }])
    await expect(assertPayable(db, 'inv-1', 'c1', 480, 'p1')).resolves.toBeUndefined()
  })

  it('refuses another customer\'s invoice, a draft, a cancelled invoice and a credit note', async () => {
    await expect(assertPayable(fakeDb([issued()]), 'inv-1', 'someone-else', 10)).rejects.toMatchObject({ code: 'CLIENT_MISMATCH' })
    await expect(assertPayable(fakeDb([issued({ status: 'DRAFT' })]), 'inv-1', 'c1', 10)).rejects.toMatchObject({ code: 'NOT_PAYABLE' })
    await expect(assertPayable(fakeDb([issued({ status: 'CANCELLED' })]), 'inv-1', 'c1', 10)).rejects.toMatchObject({ code: 'NOT_PAYABLE' })
    await expect(assertPayable(fakeDb([issued({ kind: 'CREDIT_NOTE' })]), 'inv-1', 'c1', 10)).rejects.toMatchObject({ code: 'NOT_PAYABLE' })
  })
})

describe('issueInvoice', () => {
  const client = { name: 'Bâtir Isère', billingAddress: '12 rue X', siret: '123', paymentTermsDays: 30 }
  const line = { unitPrice: 85, explanation: '', label: 'Pose' }

  // Found by issuing the same draft four times at once: four numbers were consumed.
  it('only the request that still finds a draft gets a number', async () => {
    const draft = issued({ status: 'DRAFT', number: null, client, lines: [line] })
    const db = fakeDb([draft])
    const first = await issueInvoice(db, 't1', 'inv-1')
    expect(first.number).toBe('FAC-2026-00001')
    // A second request that read the draft before the first one committed:
    db.invoice.findFirst.mockResolvedValueOnce({ ...draft, status: 'DRAFT', lines: [line], client, contract: null } as never)
    await expect(issueInvoice(db, 't1', 'inv-1')).rejects.toMatchObject({ status: 422, code: 'NOT_DRAFT' })
    const { nextNumber } = await import('../numbering')
    expect(nextNumber).toHaveBeenCalledTimes(1)
  })

  it('a credit note cannot take more off an invoice than its total', async () => {
    const original = issued({ id: 'inv-1', totalTTC: 480 })
    const earlier = { id: 'cn-0', kind: 'CREDIT_NOTE', status: 'ISSUED', creditedInvoiceId: 'inv-1', totalTTC: -400 }
    const tooMuch = { id: 'cn-1', clientId: 'c1', kind: 'CREDIT_NOTE', status: 'DRAFT', number: null, creditedInvoiceId: 'inv-1', totalTTC: -168, dueDate: null, client, lines: [line] }
    const db = fakeDb([original, earlier, tooMuch])
    await expect(issueInvoice(db, 't1', 'cn-1')).rejects.toMatchObject({ status: 422, code: 'CREDIT_EXCEEDS_INVOICE' })
    expect(original.creditedTTC).toBe(0)
  })

  it('an issued credit note is recorded on the invoice; a full one cancels it', async () => {
    const original = issued({ id: 'inv-1', totalTTC: 480 })
    const partial = { id: 'cn-1', clientId: 'c1', kind: 'CREDIT_NOTE', status: 'DRAFT', number: null, creditedInvoiceId: 'inv-1', totalTTC: -168, dueDate: null, client, lines: [line] }
    const db = fakeDb([original, partial])
    await issueInvoice(db, 't1', 'cn-1')
    expect(original).toMatchObject({ creditedTTC: 168, status: 'ISSUED' })

    const rest = { id: 'cn-2', clientId: 'c1', kind: 'CREDIT_NOTE', status: 'DRAFT', number: null, creditedInvoiceId: 'inv-1', totalTTC: -312, dueDate: null, client, lines: [line] }
    const db2 = fakeDb([original, { ...partial, status: 'ISSUED' }, rest])
    await issueInvoice(db2, 't1', 'cn-2')
    expect(original).toMatchObject({ creditedTTC: 480, status: 'CANCELLED' })
  })
})
