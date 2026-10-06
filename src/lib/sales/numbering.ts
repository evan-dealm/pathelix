import type { TenantDb } from '@/lib/tenantDb'

export type SequenceKind = 'QUOTE' | 'ORDER' | 'INVOICE' | 'CREDIT_NOTE' | 'CONTRACT'

type SeqDb = Pick<TenantDb, 'documentSequence'>

/**
 * Next number of a per-tenant, per-year sequence: `PREFIX-2026-00042`. The increment is a single
 * atomic UPDATE (the row is locked by PostgreSQL for the transaction), so two concurrent issues
 * never get the same number. Call it inside the transaction that writes the document: a rollback
 * gives the number back, which keeps invoice numbering gap-free.
 */
export async function nextNumber(db: SeqDb, tenantId: string, kind: SequenceKind, prefix: string, date: Date = new Date()): Promise<string> {
  const year = date.getFullYear()
  for (let attempt = 0; ; attempt++) {
    try {
      const row = await db.documentSequence.upsert({
        // The compound unique key structurally requires tenantId (getTenantDb also scopes it).
        where:  { tenantId_kind_year: { tenantId, kind, year } },
        create: { kind, year, next: 2 } as Parameters<SeqDb['documentSequence']['upsert']>[0]['create'],
        update: { next: { increment: 1 } },
        select: { next: true },
      })
      return formatNumber(prefix, year, row.next - 1)
    } catch (err) {
      // Two first-of-the-year documents racing on the create: the loser retries as an update.
      if (attempt < 2 && (err as { code?: string }).code === 'P2002') continue
      throw err
    }
  }
}

export function formatNumber(prefix: string, year: number, n: number): string {
  const p = (prefix || 'DOC').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 10) || 'DOC'
  return `${p}-${year}-${String(n).padStart(5, '0')}`
}
