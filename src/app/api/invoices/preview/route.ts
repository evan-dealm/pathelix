import { z } from 'zod'
import { apiRoute } from '@/lib/api/route'
import { billableFromField } from '@/lib/sales/invoices'
import { computeTotals } from '@/lib/pricing/engine'
import { assertTenantRefs } from '@/lib/tenantRefs'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const PreviewSchema = z.object({ clientId: z.string().min(1), contractId: z.string().nullable().optional(), orderId: z.string().nullable().optional(), periodStart: day, periodEnd: day })

/** What a customer owes for a period, from the field — before creating the draft. */
export const POST = apiRoute({ name: '/api/invoices/preview', permission: 'manage_billing', schema: PreviewSchema }, async ({ db, tenantId, body }) => {
  await assertTenantRefs(db, { clientId: body.clientId, contractId: body.contractId ?? undefined, orderId: body.orderId ?? undefined })
  const draft = await billableFromField(db, tenantId, body)
  return { ...draft, totals: computeTotals(draft.lines) }
})
