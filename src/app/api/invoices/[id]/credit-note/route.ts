import { apiRoute } from '@/lib/api/route'
import { CreditNoteSchema } from '@/lib/sales/schemas'
import { createCreditNote } from '@/lib/sales/invoices'

/** Draft credit note on an issued invoice — the whole invoice, or the lines given. */
export const POST = apiRoute(
  {
    name: '/api/invoices/[id]/credit-note',
    permission: 'manage_billing',
    schema: CreditNoteSchema,
  },
  async ({ db, tenantId, userId, body, params }) => {
    return createCreditNote(db, tenantId, userId, params.id, body.lines)
  },
)
