import { describe, it, expect } from 'vitest'
import { entriesOf, buildFec, buildJournalCsv } from '../accounting'
import { formatNumber } from '../numbering'
import { buildLines, daysBetween, addDaysIso } from '../lines'
import { effectiveInvoiceStatus } from '../invoices'
import { effectiveQuoteStatus } from '../quotes'

const inv = { number: 'FAC-2026-00001', kind: 'INVOICE', issueDate: '2026-10-06', clientName: 'BTP Isère', clientCode: 'C001', totalTTC: 175, lines: [{ amountHT: 100, vatRate: 20 }, { amountHT: 50, vatRate: 10 }] }

describe('accounting export', () => {
  it('each document is balanced: customer debit = sales + VAT credits', () => {
    const e = entriesOf(inv)
    const debit = e.reduce((a, x) => a + x.debit, 0)
    const credit = e.reduce((a, x) => a + x.credit, 0)
    expect(debit).toBeCloseTo(credit, 2)
    expect(e[0]).toMatchObject({ account: '411000', aux: 'C001', debit: 175 })
  })
  it('a credit note reverses the sides', () => {
    const e = entriesOf({ ...inv, kind: 'CREDIT_NOTE', number: 'AV-2026-00001', lines: inv.lines.map(l => ({ ...l, amountHT: -l.amountHT })) })
    expect(e[0]).toMatchObject({ account: '411000', debit: 0, credit: 175 })
    expect(e.filter(x => x.account === '706000').every(x => x.debit > 0)).toBe(true)
  })
  it('FEC has the 18 legal columns and French decimals', () => {
    const fec = buildFec([inv]).split('\r\n')
    expect(fec[0].split('\t')).toHaveLength(18)
    expect(fec[1]).toContain('175,00')
    expect(fec[1].split('\t')[3]).toBe('20261006')
  })
  it('CSV neutralises spreadsheet formulas', () => {
    const csv = buildJournalCsv([{ ...inv, clientName: '=HYPERLINK("x")' }])
    expect(csv).not.toMatch(/;=HYPERLINK/)
  })
})

describe('documents', () => {
  it('numbers are prefixed, yearly and zero-padded', () => {
    expect(formatNumber('FAC', 2026, 42)).toBe('FAC-2026-00042')
    expect(formatNumber('F/A C', 2026, 1)).toBe('FAC-2026-00001')
  })
  it('lines: amounts rounded, discount applied, VAT default', () => {
    const { lines, totals } = buildLines([{ label: 'Pose', quantity: 3, unitPrice: 33.333, discountPct: 10 }], 20)
    expect(lines[0]).toMatchObject({ unitPrice: 33.33, amountHT: 90, vatRate: 20 })
    expect(totals.totalTTC).toBe(108)
  })
  it('date helpers', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30)
    expect(addDaysIso('2026-12-20', 30)).toBe('2027-01-19')
  })
  it('overdue and expired are derived from the dates', () => {
    expect(effectiveInvoiceStatus({ status: 'ISSUED', dueDate: '2026-10-01', totalTTC: 100, amountPaid: 0 }, '2026-10-06')).toBe('OVERDUE')
    expect(effectiveInvoiceStatus({ status: 'PARTIALLY_PAID', dueDate: '2026-10-01', totalTTC: 100, amountPaid: 100 }, '2026-10-06')).toBe('PARTIALLY_PAID')
    expect(effectiveInvoiceStatus({ status: 'DRAFT', dueDate: '2026-10-01', totalTTC: 100, amountPaid: 0 }, '2026-10-06')).toBe('DRAFT')
    expect(effectiveQuoteStatus({ status: 'SENT', validUntil: '2026-10-05' }, '2026-10-06')).toBe('EXPIRED')
    expect(effectiveQuoteStatus({ status: 'ACCEPTED', validUntil: '2026-10-05' }, '2026-10-06')).toBe('ACCEPTED')
  })
})
