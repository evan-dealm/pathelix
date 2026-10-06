import { round2 } from '@/lib/pricing/engine'

/**
 * Accounting exports of issued invoices and credit notes — what accountants import into Sage,
 * Cegid, EBP or SAP: the legal FEC (Fichier des écritures comptables, art. A47 A-1 LPF) and a plain
 * sales-journal CSV. Accounts are configurable; defaults follow the French chart of accounts.
 */

export interface ExportInvoice {
  number:     string
  kind:       string // INVOICE | CREDIT_NOTE
  issueDate:  string
  clientName: string
  clientCode: string
  totalTTC:   number
  lines:      Array<{ amountHT: number; vatRate: number }>
}

export interface AccountPlan {
  journalCode:   string
  journalLabel:  string
  customerAccount: string
  salesAccount:  string
  vatAccount:    string
}

export const DEFAULT_ACCOUNTS: AccountPlan = {
  journalCode: 'VT', journalLabel: 'Ventes', customerAccount: '411000', salesAccount: '706000', vatAccount: '445710',
}

interface Entry { account: string; accountLabel: string; aux: string; auxLabel: string; label: string; debit: number; credit: number }

/** Balanced entries of one document: customer TTC against sales HT and VAT per rate. */
export function entriesOf(inv: ExportInvoice, a: AccountPlan = DEFAULT_ACCOUNTS): Entry[] {
  const byRate = new Map<number, number>()
  for (const l of inv.lines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + l.amountHT)
  const out: Entry[] = []
  const label = `${inv.kind === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'} ${inv.number} ${inv.clientName}`.slice(0, 100)
  const debitCredit = (amount: number, debitSide: boolean) => {
    const v = round2(Math.abs(amount))
    // Credit notes carry negative amounts: the sign alone decides the side.
    const positive = amount >= 0
    const isDebit = debitSide ? positive : !positive
    return { debit: isDebit ? v : 0, credit: isDebit ? 0 : v }
  }
  let totalCredit = 0
  for (const [rate, base] of [...byRate.entries()].sort((x, y) => x[0] - y[0])) {
    const ht = round2(base)
    const vat = round2(base * rate / 100)
    if (ht !== 0) { out.push({ account: a.salesAccount, accountLabel: 'Prestations de services', aux: '', auxLabel: '', label, ...debitCredit(ht, false) }); totalCredit += ht }
    if (vat !== 0) { out.push({ account: a.vatAccount, accountLabel: `TVA collectée ${rate} %`, aux: '', auxLabel: '', label, ...debitCredit(vat, false) }); totalCredit += vat }
  }
  out.unshift({ account: a.customerAccount, accountLabel: 'Clients', aux: inv.clientCode, auxLabel: inv.clientName, label, ...debitCredit(round2(totalCredit), true) })
  return out
}

const fecAmount = (n: number) => n.toFixed(2).replace('.', ',')
const fecDate = (d: string) => d.replace(/-/g, '')
const clean = (s: string) => s.replace(/[\t\r\n|]/g, ' ').trim()

/** FEC: 18 tab-separated columns, one line per entry, one entry number per document. */
export function buildFec(invoices: ExportInvoice[], a: AccountPlan = DEFAULT_ACCOUNTS): string {
  const head = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise']
  const rows = [head.join('\t')]
  const sorted = [...invoices].sort((x, y) => x.issueDate.localeCompare(y.issueDate) || x.number.localeCompare(y.number))
  sorted.forEach((inv, i) => {
    const num = String(i + 1).padStart(6, '0')
    for (const e of entriesOf(inv, a)) {
      rows.push([
        a.journalCode, a.journalLabel, num, fecDate(inv.issueDate), e.account, e.accountLabel, e.aux, clean(e.auxLabel),
        inv.number, fecDate(inv.issueDate), clean(e.label), fecAmount(e.debit), fecAmount(e.credit), '', '', fecDate(inv.issueDate), '', '',
      ].join('\t'))
    }
  })
  return rows.join('\r\n') + '\r\n'
}

const csvCell = (v: string | number) => {
  const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v
  // Neutralise spreadsheet formulas (=, +, -, @ at the start of a text cell).
  const safe = typeof v === 'string' && /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Sales journal as CSV (semicolon, French decimals) — importable by Sage and most tools. */
export function buildJournalCsv(invoices: ExportInvoice[], a: AccountPlan = DEFAULT_ACCOUNTS): string {
  const rows = [['Date', 'Journal', 'Compte', 'Compte auxiliaire', 'Pièce', 'Libellé', 'Débit', 'Crédit'].join(';')]
  for (const inv of [...invoices].sort((x, y) => x.issueDate.localeCompare(y.issueDate))) {
    for (const e of entriesOf(inv, a)) {
      rows.push([inv.issueDate.split('-').reverse().join('/'), a.journalCode, e.account, e.aux, inv.number, e.label, e.debit, e.credit].map(csvCell).join(';'))
    }
  }
  return '﻿' + rows.join('\r\n') + '\r\n'
}
