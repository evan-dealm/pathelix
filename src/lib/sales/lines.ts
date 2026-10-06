import { computeTotals, round2, type Totals } from '@/lib/pricing/engine'
import type { SalesLineInput } from './schemas'

/** A document line as stored (quote, order and invoice lines share this shape). */
export interface StoredLine {
  position:        number
  label:           string
  description:     string
  quantity:        number
  unit:            string
  unitPrice:       number
  discountPct:     number
  vatRate:         number
  amountHT:        number
  explanation:     string
  missionType:     string | null
  containerTypeId: string | null
  materialId:      string | null
  plannedDate:     string | null
}

/** Normalises input lines (defaults, rounded amounts) and computes the document totals. */
export function buildLines(input: SalesLineInput[], defaultVatRate = 20): { lines: StoredLine[]; totals: Totals } {
  const lines = input.map((l, i) => {
    const discountPct = l.discountPct ?? 0
    return {
      position:        i,
      label:           l.label,
      description:     l.description ?? '',
      quantity:        l.quantity,
      unit:            l.unit ?? 'UNIT',
      unitPrice:       round2(l.unitPrice),
      discountPct,
      vatRate:         l.vatRate ?? defaultVatRate,
      amountHT:        round2(l.quantity * l.unitPrice * (1 - discountPct / 100)),
      explanation:     l.explanation ?? 'Prix saisi',
      missionType:     l.missionType ?? null,
      containerTypeId: l.containerTypeId ?? null,
      materialId:      l.materialId ?? null,
      plannedDate:     l.plannedDate ?? null,
    }
  })
  return { lines, totals: computeTotals(lines) }
}

/** YYYY-MM-DD of a Date (local calendar). */
export function isoDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + n))
}

/** Whole days between two YYYY-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}
