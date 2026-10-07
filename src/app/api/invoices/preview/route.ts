import { InvoicePreviewSchema } from '@/lib/sales/schemas'
import { apiRoute } from '@/lib/api/route'
import { billableFromField } from '@/lib/sales/invoices'
import { computeTotals } from '@/lib/pricing/engine'
import { assertTenantRefs } from '@/lib/tenantRefs'

/** What a customer owes for a period, from the field — before creating the draft. */
export const POST = apiRoute(
  { name: '/api/invoices/preview', permission: 'manage_billing', schema: InvoicePreviewSchema },
  async ({ db, tenantId, body }) => {
    await assertTenantRefs(db, {
      clientId: body.clientId,
      contractId: body.contractId ?? undefined,
      orderId: body.orderId ?? undefined,
    })
    const draft = await billableFromField(db, tenantId, body)
    return { ...draft, totals: computeTotals(draft.lines) }
  },
)
