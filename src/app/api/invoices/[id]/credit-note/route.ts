import { z } from 'zod'
import { apiRoute } from '@/lib/api/route'
import { SalesLineSchema } from '@/lib/sales/schemas'
import { createCreditNote } from '@/lib/sales/invoices'

const CreditSchema = z.object({ lines: z.array(SalesLineSchema).max(500).optional() })

/** Draft credit note on an issued invoice — the whole invoice, or the lines given. */
export const POST = apiRoute({ name: '/api/invoices/[id]/credit-note', permission: 'manage_billing', schema: CreditSchema }, async ({ db, tenantId, userId, body, params }) => {
  return createCreditNote(db, tenantId, userId, params.id, body.lines)
})
